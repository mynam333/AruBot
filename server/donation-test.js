import { randomUUID } from 'node:crypto';
import { assertSafeTextPayload } from '../shared/text-safety.js';
import { assertBotManagerEffects, hasBotManagerScope } from '../shared/bot-management-policy.js';
import { donationRuleMatchesMessage } from './rule-pattern.js';

function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }

export function createDonationTestHandler(deps) {
  const requests = new Map();
  const cooldowns = new Map();
  return async (req, res) => {
    try {
      const sid = await deps.getPartitionId(req, res);
      if (!sid) throw invalid('로그인이 필요합니다.', 401);
      const access = req.botManagement;
      if (access && !hasBotManagerScope(access, 'donations', 'write')) throw invalid('후원 반응 수정 권한이 필요합니다.', 403);
      const body = req.body || {};
      if (body.confirmExecution !== true) throw invalid('실제 실행 확인이 필요합니다.');
      const amount = body.amount;
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const message = typeof body.message === 'string' ? body.message : '';
      const provider = body.provider || 'chzzk';
      const requestId = body.requestId;
      if (body.message != null && typeof body.message !== 'string') throw invalid('메시지는 텍스트로 입력해 주세요.');
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000) throw invalid('후원 금액은 1~100,000,000원의 정수로 입력해 주세요.');
      if (!username || username.length > 80 || message.length > 1000) throw invalid('시청자명은 1~80자, 메시지는 1,000자 이하로 입력해 주세요.');
      if (!['chzzk', 'cime', 'youtube'].includes(provider)) throw invalid('지원하지 않는 플랫폼입니다.');
      if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw invalid('테스트 요청 ID가 필요합니다.');
      assertSafeTextPayload({ username, message });
      const settings = await deps.getBotSettings(sid) || {};
      const rules = (settings.donationRules || []).filter(rule => rule && rule.enabled !== false
        && deps.donationRuleMatchesAmount(rule, amount) && donationRuleMatchesMessage(rule, message));
      if (rules.length > 30) throw invalid('한 번에 최대 30개 반응을 테스트할 수 있습니다.');
      // Authorize all matched actions before the first side effect.
      for (const rule of rules) {
        assertSafeTextPayload(rule);
        assertBotManagerEffects(rule, access);
        if (access?.role === 'manager' && rule.name && !hasBotManagerScope(access, 'automations', 'write')) {
          throw invalid('로컬 명령 테스트에는 방송 자동화 수정 권한이 필요합니다.', 403);
        }
      }
      if (body.sendChat === true && access && !hasBotManagerScope(access, 'commands', 'write')) throw invalid('채팅 전송 권한이 필요합니다.', 403);
      const connection = await deps.resolveContext(sid, provider, username);
      const key = `${sid}:${requestId}`;
      for (const [id, expiry] of requests) if (expiry <= Date.now()) requests.delete(id);
      for (const [id, expiry] of cooldowns) if (expiry <= Date.now()) cooldowns.delete(id);
      if (requests.has(key)) throw invalid('이미 실행한 테스트입니다. 새 테스트를 시작해 주세요.', 409);
      if (requests.size >= 1000) throw invalid('테스트 요청이 많습니다. 잠시 후 다시 시도해 주세요.', 429);
      if (cooldowns.has(sid)) throw invalid('테스트는 5초 간격으로 실행해 주세요.', 429);
      cooldowns.set(sid, Date.now() + 5000);
      const cooldown = await deps.claimRuntimeLease(`donation-test-cooldown:${sid}`, randomUUID(), 5000);
      if (!cooldown?.acquired) throw invalid('테스트는 5초 간격으로 실행해 주세요.', 429);
      requests.set(key, Date.now() + 5 * 60_000);
      const leaseOwner = randomUUID();
      const lease = await deps.claimRuntimeLease(`donation-test:${key}`, leaseOwner, 5 * 60_000);
      if (!lease?.acquired) throw invalid('이미 실행한 테스트입니다. 새 테스트를 시작해 주세요.', 409);
      const cleanup = setTimeout(() => {
        void deps.releaseRuntimeLease(`donation-test:${key}`, leaseOwner).catch(() => {});
      }, 5 * 60_000);
      cleanup.unref?.();
      const context = {
        ...connection, sid, provider, amount, username, message,
        userId: `donation-test:${sid.replace(/^user:/, '')}`, source: 'donation-test',
        chatPost: { ...connection.chatPost, suppressResultChat: body.sendChat !== true },
      };
      const results = [];
      for (const rule of rules) {
        try {
          const result = await deps.renderDonationRuleResponse(rule, context);
          const errors = result.errors.map(item => String(item.error?.message || item.error || item.phase));
          let chatSent = false;
          if (body.sendChat === true && result.text) {
            try {
              const sent = await deps.sendChatByPost(sid, context.chatPost, result.text);
              if (sent == null) throw invalid('현재 플랫폼 채팅에 전송할 수 없습니다.');
              chatSent = true;
            } catch (error) { errors.push(`채팅: ${error.message}`); }
          }
          await deps.recordDonationRuleExecutionLog(sid, {
            ...context, ruleId: rule.id, ruleName: rule.name, features: result.features,
            summary: `후원 반응 테스트: ${rule.name || '이름 없음'} · ${amount.toLocaleString('ko-KR')}원 (포인트 지급 없음)`,
          });
          results.push({ ruleId: rule.id, ruleName: rule.name || '이름 없음', text: result.text,
            status: errors.length ? 'partial' : 'executed', features: result.features,
            desktopSent: result.desktopSent, repeatCount: result.repeatCount, chatSent, errors });
        } catch (error) {
          results.push({ ruleId: rule.id, ruleName: rule.name || '이름 없음', status: 'failed', text: '', features: [], desktopSent: 0, repeatCount: 0, chatSent: false, errors: [String(error.message || error)] });
        }
      }
      return res.json({ ok: true, test: true, matchedCount: rules.length, pointsAwarded: 0, results });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.status ? error.message : '후원 테스트를 실행하지 못했습니다.', code: error.code });
    }
  };
}

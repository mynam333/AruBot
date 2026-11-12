export const COMMAND_PERMISSION_OPTIONS = [
  { value: 'streamer', label: '스트리머만' },
  { value: 'manager', label: '매니저 이상' },
  { value: 'subscriber', label: '구독자 이상' },
  { value: 'everyone', label: '모두 가능' },
];

export function isCommandPermission(value) {
  return COMMAND_PERMISSION_OPTIONS.some(option => option.value === value);
}

export function getCommandPermission(rule = {}) {
  if (isCommandPermission(rule.executionPermission)) return rule.executionPermission;
  const legacy = Number(rule.requiredRoleLevel || (rule.adminOnly ? 3 : 1));
  return legacy >= 4 ? 'streamer' : legacy > 1 ? 'manager' : 'everyone';
}

export function commandPermissionLabel(rule) {
  return COMMAND_PERMISSION_OPTIONS.find(option => option.value === getCommandPermission(rule)).label;
}

export function canExecuteCommand(rule, actor = {}) {
  if (rule.executionPermission == null) {
    return Number(actor.roleLevel || 1) >= Number(rule.requiredRoleLevel || (rule.adminOnly ? 3 : 1));
  }
  switch (rule.executionPermission) {
    case 'everyone': return true;
    case 'streamer': return actor.isOwner === true;
    case 'manager': return actor.isOwner === true || actor.isManager === true;
    case 'subscriber': return actor.isOwner === true || actor.isManager === true || actor.isSubscriber === true;
    default: return false;
  }
}

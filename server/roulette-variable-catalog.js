// Advertise only values the roulette result renderer can actually resolve.
export function withRouletteVariableContext(variable) {
  const key = String(variable.key || '');
  let note = '';
  let description = variable.description;
  let caveat = variable.caveat;
  if (/^\$\{(?:roulette|action|automation|blueprint|pngtuber|짚톡)::/.test(key)) {
    note = '룰렛에서는 당첨 확정 후 실행하며 추가 명령어 비용을 차감하지 않습니다. 한 결과당 특수 실행은 최대 16개입니다. 같은 실행 묶음에서 동일 룰렛은 최초 실행 포함 최대 5회이며, 분기하거나 다른 룰렛을 거쳐도 합산합니다. 명령어·블루프린트 순환은 즉시 중단합니다. 기존 로컬 프로그램·오버레이 연결을 사용합니다.';
  } else if (key === '${video_donation}' || key === '${bgm_request}') {
    note = '룰렛에서는 변수 뒤에 주소 또는 검색어와 재생 구간을 적습니다. 예: ${video_donation} https://youtu.be/영상ID 0:00 1:00. 등록된 명령어를 실행한 경우 해당 명령어의 인자를 사용합니다. 룰렛 보상은 포인트를 차감하지 않지만 기능 활성화·차단·최대 길이 제한은 유지됩니다.';
  } else if (key === '${songbook_request}') {
    note = '룰렛에서는 변수 뒤에 신청할 곡명 또는 가수와 곡명을 적습니다. 등록된 명령어 실행 시에는 해당 명령어 인자를 사용하며 접수 설정과 인당 한도를 유지합니다.';
  } else if (key === '${songbook_url}') {
    note = '룰렛을 소유한 스트리머의 노래책 주소를 표시합니다.';
  } else if (/^\$\{live\.(?:title|game)_change\}$/.test(key)) {
    note = '룰렛에서는 변수 뒤의 문장을 변경 값으로 사용합니다. 최초 실행자의 현재 방송 관리 권한을 다시 확인하며 일반 시청자의 당첨으로 권한을 우회할 수 없습니다. YouTube에서는 지원하지 않습니다.';
  } else if (/^\$\{memo::/.test(key)) {
    note = '룰렛에서는 이름 있는 메모를 읽기만 합니다. 실행자가 관리자여도 메모를 수정하지 않으며 메모 속 특수 변수는 실행하지 않습니다.';
  } else if (/^\$\{counter::/.test(key)) {
    note = '룰렛에서는 당첨 결과가 실행될 때 증가합니다. 같은 결과 안의 동일 변수는 한 번만 증가하며 시청자별 카운트는 최초 실행자와 플랫폼을 기준으로 합니다.';
  } else if (/^\{roulette\.(?:name|result\.(?:label|value))\}$/.test(key)) {
    description = key === '{roulette.name}' ? '현재 결과를 만든 룰렛 이름입니다.'
      : key.endsWith('label}') ? '현재 룰렛 당첨 항목의 이름입니다.' : '현재 룰렛 당첨 항목에 저장된 실행 값입니다.';
    caveat = '룰렛 결과 실행과 그 결과가 호출한 블루프린트에서 사용합니다. 표시된 값 안의 특수 변수는 다시 실행하지 않습니다.';
  } else if (/^\{user\.(?:name|id|username|nickname|points|channelPoints|attendanceDays|followedAt|followedDays|subscriptionMonths)\}$/.test(key)) {
    note = '룰렛에서는 최초 실행자의 정보를 해당 플랫폼 기준으로 조회합니다. 포인트·출석 조회는 값을 변경하지 않으며 플랫폼에서 제공하지 않는 정보는 기존 대체 값으로 표시합니다.';
  } else if (/^\{live\.(?:title|category|viewers|startedAt|elapsed|elapsed_ko|channel)\}$/.test(key)
    || key === '{channel.followers}' || /^\$\{dday::/.test(key)) {
    note = '룰렛에서는 해당 채널과 실행 플랫폼 기준의 읽기 전용 값입니다. 방송 종료나 플랫폼 미지원 정보는 기존 대체 값으로 표시합니다.';
  } else {
    return variable;
  }
  return { ...variable, description,
    contexts: [...new Set([...(variable.contexts || ['command', 'blueprint', 'attendance', 'donation']), 'roulette'])],
    caveat: [caveat, note].filter(Boolean).join(' '),
  };
}

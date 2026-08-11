const SOCKET_IO2_ZERO_ATTACHMENT_GUARD = Symbol.for('arubot.chzzk.socket-io2.zero-attachment-guard');
const SOCKET_IO2_MAX_BINARY_ATTACHMENTS = 10;
function hasInvalidBinaryAttachmentCount(packet) {
  if (typeof packet !== 'string' || (packet[0] !== '5' && packet[0] !== '6')) return false;
  const separatorIndex = packet.indexOf('-', 1);
  if (separatorIndex < 0) return false;
  const attachmentText = packet.slice(1, separatorIndex);
  const attachmentCount = Number(attachmentText);
  return !Number.isSafeInteger(attachmentCount)
    || attachmentCount < 1
    || attachmentCount > SOCKET_IO2_MAX_BINARY_ATTACHMENTS;
}

export function installChzzkSocketIo2ParserGuard(parserModule) {
  const parser = parserModule?.default || parserModule;
  const decoderPrototype = parser?.Decoder?.prototype;
  const originalAdd = decoderPrototype?.add;
  if (typeof originalAdd !== 'function') {
    throw new Error('Pinned Socket.IO 2.x parser is unavailable');
  }
  if (originalAdd[SOCKET_IO2_ZERO_ATTACHMENT_GUARD] === true) return false;

  function guardedAdd(packet) {
    if (hasInvalidBinaryAttachmentCount(packet)) {
      throw new Error('Illegal attachments');
    }
    return originalAdd.call(this, packet);
  }
  Object.defineProperty(guardedAdd, SOCKET_IO2_ZERO_ATTACHMENT_GUARD, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  decoderPrototype.add = guardedAdd;
  return true;
}

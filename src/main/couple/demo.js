'use strict';
/** 演示伴侣「阿橘」：未配置联机后端或未配对时的本地回退，让新用户也能体验互动。 */
const DEMO_PARTNER = { uid: 'demo_aju', name: '阿橘', skinId: 'sakura' };
const REPLY = { poke: 'poke', heart: 'heart', hug: 'hug', kiss: 'heart', highfive: 'highfive', holdhands: 'holdhands', goodnight: 'goodnight' };
const NOTE_REPLIES = ['收到啦～', '我也想你！', '嘿嘿，抱一个', '好呀，等你'];
function demoReply(kind, input, i = 0) {
  if (kind === 'interact') return { type: 'interact', payload: { action: REPLY[input.action] || 'heart', combo: true } };
  if (kind === 'note') return { type: 'note', payload: { text: NOTE_REPLIES[i % NOTE_REPLIES.length], tts: true, lang: 'zh-CN' } };
  if (kind === 'focus.start') return { type: 'focus.join', payload: { sessionId: input.sessionId } };
  if (kind === 'farm.event' && input && (input.kind === 'checkin' || input.kind === 'water')) return { type: 'farm.event', payload: { kind: input.kind, day: input.day } };
  return null;
}
module.exports = { DEMO_PARTNER, demoReply };

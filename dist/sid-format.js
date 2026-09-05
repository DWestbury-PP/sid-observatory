// Strict compatibility boundary. Metadata never becomes HTML.
const MODELS = { 1: 6581, 2: 8580, 3: 8580 };
// PSID v3/v4 store extra SID chips as (address >> 4) & 0xFF: $D420–$D7E0 or $DE00–$DFE0, even values only.
// Per the specification, any invalid value means no extra chip, like 0x00.
export function sidAddress(byte) {
  if (byte & 1 || byte < 0x42 || (byte >= 0x80 && byte < 0xE0)) return 0;
  return 0xD000 + byte * 16;
}
export function parseSID(buffer, filename = 'Untitled') {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 118 || buffer.byteLength > 65792) throw new Error('That file is not a valid SID file (118–65,792 bytes).');
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  const word = offset => view.getUint16(offset, false);
  const magic = String.fromCharCode(...bytes.slice(0, 4));
  if (magic === 'RSID') throw new Error('RSID needs fuller C64 emulation. This version supports PSID tunes.');
  if (magic !== 'PSID') throw new Error('This file does not have a PSID header.');
  const version = word(4);
  if (version < 1 || version > 4) throw new Error('Unsupported PSID version.');
  const headerSize = version === 1 ? 118 : 124;
  if (bytes.length < headerSize) throw new Error('The SID header is truncated.');
  let offset = word(6);
  if (offset < headerSize || offset >= bytes.length) throw new Error('The SID data offset is invalid.');
  const flags = version >= 2 ? word(118) : 0;
  if (flags & 3) throw new Error('MUS and PlaySID-specific files are not supported in this version.');
  if (((flags >> 2) & 3) === 2) throw new Error('This is an NTSC tune. PAL playback is supported in this version.');
  // Chip 1 defaults to 8580 when unknown; chips 2 and 3 inherit chip 1 when their model bits are unknown.
  const model = MODELS[(flags >> 4) & 3] || 8580;
  const chips = [{ address: 0xD400, model }];
  const second = version >= 3 ? sidAddress(bytes[122]) : 0, third = version >= 4 && second ? sidAddress(bytes[123]) : 0;
  if (second) chips.push({ address: second, model: MODELS[(flags >> 6) & 3] || model });
  // The third SID cannot share the second SID's address.
  if (third && third !== second) chips.push({ address: third, model: MODELS[(flags >> 8) & 3] || model });
  let load = word(8);
  if (!load) {
    if (offset + 2 >= bytes.length) throw new Error('The load address or program is missing.');
    load = bytes[offset] | bytes[offset + 1] << 8; offset += 2;
  }
  if (load + bytes.length - offset > 65536) throw new Error('This tune extends beyond the C64 address space.');
  const init = word(10) || load, play = word(12), songs = word(14), start = word(16);
  if (!songs || songs > 256 || !start || start > songs) throw new Error('Invalid subtune count or default subtune.');
  if (!play) throw new Error('This tune uses an interrupt-driven player that this version does not support.');
  const text = at => new TextDecoder('windows-1252').decode(bytes.slice(at, at + 32)).split('\0')[0].replace(/[\x00-\x1f\x7f]/g, '').trim();
  return { title:text(22) || filename.replace(/\.sid$/i,''), author:text(54) || 'Unknown composer', released:text(86), version, songs, start:start-1, flags, load, init, play, offset, speed:view.getUint32(18, false), model, chips, assumedPAL:!(flags & 12) };
}

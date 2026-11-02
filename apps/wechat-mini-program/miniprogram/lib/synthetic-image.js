// Fixed 96x96 four-colour PNG; generated locally, not a game asset or user photo.
// Byte-for-byte verification is deliberately fixture-only, not a general photo validator.
const HEX = '89504e470d0a1a0a0000000d49484452000000600000006008020000006dfae06f000000b849444154789cedd0410d8040100031c4a2e9e4a0e444f0e6850b76129a54418f7b5d29e77a528ef111418204090a191f11244890a0104182040912244890204111e32382040912142248902041820409122428627c44902041824204091224489020418204458c8f081224e8dba07da59cfb491124489020418204091214313e2248902041218204091224489020418222c64704091224284490204182040912244850c4f8882041820485081224489020418204fd35e8059582e0b193c7258d0000000049454e44ae426082';
const HEADER = 'NS-SYNTHETIC-PNG/1 96 96\n';
function imageBytes() { return Uint8Array.from(HEX.match(/../g).map(x => parseInt(x, 16))); }
function imagePayload() {
  const image = imageBytes(), out = new Uint8Array(HEADER.length + image.length);
  out.set(Uint8Array.from(HEADER.split('').map(x => x.charCodeAt(0)))); out.set(image, HEADER.length); return out;
}
function verifyImagePayload(bytes) {
  const expected = imagePayload();
  if (!(bytes instanceof Uint8Array) || bytes.length !== expected.length || !bytes.every((v, i) => v === expected[i]))
    throw new Error('Synthetic image mismatch');
  return bytes.slice(HEADER.length);
}
module.exports = { imageBytes, imagePayload, verifyImagePayload };

function denied() { throw new Error('Native RNG disabled: secure entropy must be explicitly supplied'); }
module.exports = { randombytes_buf: denied };
Object.defineProperty(module.exports, 'randombytes', { value: denied });

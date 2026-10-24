function saveProbeCandidate(wxApi, mode, paths, alive, done) {
  const choices = { baseline: ['baseline.jpg'], motion: ['motion.jpg'], livp: ['paired.livp'], pair: ['paired.jpg','paired.mov'] };
  const names = choices[mode];
  if (!names || names.some(name => typeof paths[name] !== 'string'
    || !/\/nikkisync-live-probe-\d+-\d+-(baseline\.jpg|paired\.jpg|paired\.mov|motion\.jpg|paired\.livp)$/.test(paths[name])
    || /https?:\/\//.test(paths[name]))) throw Error('Invalid probe cache');
  let saved = 0, finished = false;
  const finish = failed => {
    if (finished) return; finished = true;
    done({ outcome: failed ? saved ? 'partial' : 'failed' : 'api_saved', saved, live: 'unverified' });
  };
  const next = index => {
    if (finished) return;
    if (index === names.length) { finish(false); return; }
    if (!alive()) { finish(true); return; }
    let settled = false;
    const success = () => { if (settled || finished) return; settled = true; saved++; next(index+1); };
    const fail = () => { if (settled || finished) return; settled = true; finish(true); };
    try {
      const method = names[index] === 'paired.mov' ? 'saveVideoToPhotosAlbum' : 'saveImageToPhotosAlbum';
      wxApi[method]({ filePath: paths[names[index]], success, fail });
    } catch (_) { fail(); }
  };
  next(0);
}
module.exports = { saveProbeCandidate };

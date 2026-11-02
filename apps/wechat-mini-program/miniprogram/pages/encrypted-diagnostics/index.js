const { parseEncryptedQr, runEncryptedProbe } = require('../../lib/encrypted-probe.js');
Page({
  data: { busy: false, message: '仅测试加密合成文本，不连接图库。请勿分享含临时密钥的诊断码。' },
  onLoad() { this._alive = true; },
  onShow() { this._active = true; if (this._pending) { const config = this._pending; this._pending = null; this.startTest(config); } },
  onHide() { this._active = false; if (this._cancel) this._cancel(); if (this._alive && !this._scanning) this.setData({ busy: false }); },
  onUnload() { this._alive = false; this._active = false; this._pending = null; if (this._cancel) this._cancel(); },
  scanTest() {
    if (!this._alive || !this._active || this.data.busy) return;
    this._scanning = true; this.setData({ busy: true, message: '扫描电脑的专用加密诊断码，勿使用旧码。' });
    wx.scanCode({ onlyFromCamera: true, scanType: ['qrCode'], success: result => {
      this._scanning = false; if (!this._alive) return; let config;
      try { config = parseEncryptedQr(result.result); } catch (_) { this.setData({ busy: false, message: '加密测试码无效或过期。' }); return; }
      if (!this._active) { this._pending = config; return; } this.startTest(config);
    }, fail: () => { this._scanning = false; if (this._alive) this.setData({ busy: false, message: '扫码取消或失败。' }); } });
  },
  startTest(config) {
    if (!this._alive || !this._active) return;
    this.setData({ busy: true, message: '正在验证扫码密钥和加密文本…' });
    this._cancel = runEncryptedProbe(wx, config, value => { if (this._alive && this._active) this.setData({ busy: false, message: value.message }); });
  }
});

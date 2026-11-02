const { parseTcpQr, runTcpProbe } = require('../../lib/tcp-probe.js');
Page({
  data: { busy: false, message: '仅交换合成测试文本，不连接图库。' },
  onLoad() { this._alive = true; },
  onHide() { this._active = false; if (this._cancel) this._cancel(); if (this._alive && !this._scanning) this.setData({ busy: false }); },
  onShow() { this._active = true; if (this._pending) { const config = this._pending; this._pending = null; this.startTest(config); } },
  onUnload() { this._alive = false; this._active = false; if (this._cancel) this._cancel(); },
  scanTest() {
    if (!this._alive || !this._active || this.data.busy) return;
    this._scanning = true;
    this.setData({ busy: true, message: '扫描专用 TCP 测试码；普通照片码和 HTTPS 码不能使用。' });
    wx.scanCode({ onlyFromCamera: true, scanType: ['qrCode'],
      success: result => {
        this._scanning = false;
        if (!this._alive) return;
        let config;
        try { config = parseTcpQr(result.result); } catch (error) { this.setData({ busy: false, message: error.message }); return; }
        if (!this._active) { this._pending = config; return; }
        this.startTest(config);
      },
      fail: () => { this._scanning = false; if (this._alive) this.setData({ busy: false, message: '扫码取消或失败。' }); }
    });
  },
  startTest(config) {
    if (!this._alive || !this._active) return;
    this.setData({ busy: true, message: '正在交换合成测试文本…' });
    this._cancel = runTcpProbe(wx, config, value => {
      if (this._alive && this._active) this.setData({ busy: false, message: value.message });
    });
  }
});

const { parseProbeQr, runProbe } = require('../../lib/lan-probe.js');
Page({
  data: { busy: false, message: '仅测试合成数据，不连接图库、不保存照片。' },
  onLoad() { this._alive = true; },
  onUnload() { this._alive = false; if (this._cancel) this._cancel(); },
  scanTest() {
    if (!this._alive || this.data.busy) return;
    this.setData({ busy: true, message: '请扫描电脑上的 HTTPS 诊断码。' });
    wx.scanCode({ onlyFromCamera: true, scanType: ['qrCode'],
      success: result => {
        if (!this._alive) return;
        let config;
        try { config = parseProbeQr(result.result); } catch (error) { this.setData({ busy: false, message: error.message }); return; }
        this.setData({ message: '正在验证 HTTPS 请求，保留微信默认证书校验…' });
        this._cancel = runProbe(wx, config, value => {
          if (!this._alive) return;
          this.setData({ busy: false, message: (value.status === 'ok' ? '测试响应成功：' : '请求未成功：') + value.message });
        });
      },
      fail: () => { if (this._alive) this.setData({ busy: false, message: '扫码取消或无法访问相机，请重试。' }); }
    });
  }
});

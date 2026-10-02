const { parseRemoteQr } = require('../../lib/remote-qr.js');

Page({
  data: { state: 'idle', message: '请先在电脑选择照片，生成临时二维码。', endpoint: '', expiresAt: '', scanning: false },
  onLoad() { this._generation = 0; this._alive = true; this._expiresAtMs = 0; },
  onShow() {
    if (this._expiresAtMs && Date.now() >= this._expiresAtMs) {
      this._expiresAtMs = 0;
      this.setData({ state: 'expired', endpoint: '', expiresAt: '', message: '二维码已过期，请在电脑上重新生成。' });
    }
  },
  onUnload() { this._alive = false; this._generation++; this._expiresAtMs = 0; },
  scanQr() {
    if (!this._alive || this.data.scanning) return;
    const generation = ++this._generation;
    this._expiresAtMs = 0;
    this.setData({ scanning: true, state: 'scanning', endpoint: '', expiresAt: '', message: '正在扫描…' });
    const current = () => this._alive && generation === this._generation;
    wx.scanCode({
      onlyFromCamera: true,
      scanType: ['qrCode'],
      success: result => {
        if (!current()) return;
        try {
          const session = parseRemoteQr(result.result);
          this._expiresAtMs = Date.parse(session.expiresAt);
          // Do not retain token/sessionId: transport trust is not established yet.
          this.setData({ scanning: false, state: 'identified', endpoint: session.endpoint,
            expiresAt: session.expiresAt.replace('T', ' ').replace('.000Z', ' UTC'),
            message: '二维码已识别，尚未连接。当前 PC 证书的微信信任方案仍待验证，暂不发送连接凭据。' });
        } catch (error) {
          this.setData({ scanning: false, state: 'error', endpoint: '', expiresAt: '', message: error.message });
        }
      },
      fail: result => {
        if (!current()) return;
        const cancelled = result && typeof result.errMsg === 'string' && /cancel/i.test(result.errMsg);
        this.setData({ scanning: false, state: cancelled ? 'idle' : 'error',
          message: cancelled ? '已取消扫码。' : '无法打开扫码，请检查微信相机权限后重试。' });
      }
    });
  }
});

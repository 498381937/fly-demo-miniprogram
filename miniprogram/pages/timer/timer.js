// pages/timer/timer.js
const util = require('../../utils/util.js');

Page({
  data: {
    // idle | running | done
    timerState: 'idle',
    // 秒表显示 HH:MM:SS
    displayTime: '00:00:00',
    // 已流逝秒数
    elapsedSeconds: 0,
    // 飞行日期
    flightDate: '',
    // 起飞/降落时间 HH:MM:SS
    takeoffTime: '',
    landingTime: '',
  },

  // 计时器句柄
  _timer: null,
  // 起飞时间戳（用于精确计算）
  _startTimestamp: 0,

  onLoad() {
    const today = new Date();
    this.setData({ flightDate: util.formatDate(today) });
  },

  onUnload() {
    this._clearTimer();
  },

  onHide() {
    // 切换到其他 tab 时若正在计时，不停止，后台继续
  },

  onShow() {
    // 若计时中，重新用时间戳校正显示
    if (this.data.timerState === 'running' && this._startTimestamp) {
      const elapsed = Math.floor((Date.now() - this._startTimestamp) / 1000);
      this.setData({
        elapsedSeconds: elapsed,
        displayTime: this._secondsToDisplay(elapsed),
      });
    }
  },

  // 开始计时
  onStart() {
    const now = new Date();
    this._startTimestamp = Date.now();

    const takeoffTime = util.formatTime(now);
    const flightDate = util.formatDate(now);

    this.setData({
      timerState: 'running',
      takeoffTime,
      flightDate,
      elapsedSeconds: 0,
      displayTime: '00:00:00',
    });

    this._startTick();
  },

  // 结束计时
  onStop() {
    this._clearTimer();

    const now = new Date();
    const landingTime = util.formatTime(now);
    const elapsed = Math.floor((Date.now() - this._startTimestamp) / 1000);

    this.setData({
      timerState: 'done',
      landingTime,
      elapsedSeconds: elapsed,
      displayTime: this._secondsToDisplay(elapsed),
    });
  },

  // 进入填报页面（携带计时数据）
  onGoReport() {
    const { flightDate, takeoffTime, landingTime } = this.data;
    const totalDuration = util.diffDuration(takeoffTime, landingTime);

    wx.navigateTo({
      url: `/pages/report/report?flightDate=${flightDate}&takeoffTime=${encodeURIComponent(takeoffTime)}&landingTime=${encodeURIComponent(landingTime)}&totalDuration=${encodeURIComponent(totalDuration)}&fromTimer=1`,
    });
  },

  // 跳过计时直接填报
  onSkip() {
    wx.navigateTo({ url: '/pages/report/report' });
  },

  // 重置计时器
  onReset() {
    this._clearTimer();
    this._startTimestamp = 0;
    this.setData({
      timerState: 'idle',
      displayTime: '00:00:00',
      elapsedSeconds: 0,
      takeoffTime: '',
      landingTime: '',
      flightDate: util.formatDate(new Date()),
    });
  },

  // ---- 内部方法 ----

  _startTick() {
    this._clearTimer();
    this._timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this._startTimestamp) / 1000);
      this.setData({
        elapsedSeconds: elapsed,
        displayTime: this._secondsToDisplay(elapsed),
      });
    }, 1000);
  },

  _clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  _secondsToDisplay(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  },
});

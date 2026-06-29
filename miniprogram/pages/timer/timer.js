// pages/timer/timer.js
const util = require('../../utils/util.js');
const app = getApp();

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

    // 预填字段
    droneModel: '',
    droneModelIndex: null,
    missionType: '',
    missionTypeIndex: null,
    flightMode: '',
    flightModeIndex: null,
    airspaceCode: '',
    airspaceCodeIndex: null,

    // picker 选项源
    droneModels: [],
    missionTypes: [],
    flightModes: [],
    airspaceCodes: ['室内实训室', '室外实训场', '校外实训场'],
  },

  // 计时器句柄
  _timer: null,
  // 起飞时间戳（用于精确计算）
  _startTimestamp: 0,

  onLoad() {
    const today = new Date();
    this.setData({
      flightDate: util.formatDate(today),
      droneModels: app.globalData.droneModels,
      missionTypes: app.globalData.missionTypes,
      flightModes: app.globalData.flightModes,
    });
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

  // 无人机型号 picker
  onDroneModelPick(e) {
    const idx = Number(e.detail.value);
    this.setData({
      droneModel: this.data.droneModels[idx],
      droneModelIndex: idx,
    });
  },

  // 任务类型 picker
  onMissionTypePick(e) {
    const idx = Number(e.detail.value);
    this.setData({
      missionType: this.data.missionTypes[idx],
      missionTypeIndex: idx,
    });
  },

  // 飞行模式 picker
  onFlightModePick(e) {
    const idx = Number(e.detail.value);
    this.setData({
      flightMode: this.data.flightModes[idx],
      flightModeIndex: idx,
    });
  },

  // 空域报备 picker
  onAirspaceCodePick(e) {
    const idx = Number(e.detail.value);
    this.setData({
      airspaceCode: this.data.airspaceCodes[idx],
      airspaceCodeIndex: idx,
    });
  },

  // 进入填报页面（携带计时数据 + 预填字段）
  onGoReport() {
    const { flightDate, takeoffTime, landingTime, droneModel, missionType, flightMode, airspaceCode } = this.data;
    const totalDuration = util.diffDuration(takeoffTime, landingTime);

    const params = [
      `flightDate=${flightDate}`,
      `takeoffTime=${encodeURIComponent(takeoffTime)}`,
      `landingTime=${encodeURIComponent(landingTime)}`,
      `totalDuration=${encodeURIComponent(totalDuration)}`,
      `fromTimer=1`,
    ];
    if (droneModel) params.push(`droneModel=${encodeURIComponent(droneModel)}`);
    if (missionType) params.push(`missionType=${encodeURIComponent(missionType)}`);
    if (flightMode) params.push(`flightMode=${encodeURIComponent(flightMode)}`);
    if (airspaceCode) params.push(`airspaceCode=${encodeURIComponent(airspaceCode)}`);

    wx.navigateTo({ url: `/pages/report/report?${params.join('&')}` });
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

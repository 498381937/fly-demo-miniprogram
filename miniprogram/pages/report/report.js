// pages/report/report.js
const app = getApp();
const util = require('../../utils/util.js');

Page({
  data: {
    // 当前激活 Tab
    activeTab: 0,
    // 是否编辑模式（携带 _id 表示编辑）
    editId: '',

    // 日志编号
    logCode: '',

    // 基础信息
    flightDate: '',
    takeoffTime: '',
    landingTime: '',
    totalDuration: '',

    pilotName: '',
    pilotId: '',
    className: '',
    teacher: '',
    droneModel: '',
    droneModelIndex: null,
    bodySn: '',
    batterySn: '',
    missionType: '',
    missionTypeIndex: null,
    airspaceCode: '',
    airspaceCodeIndex: null,

    // 飞行数据
    maxAltitude: '',
    maxHorizontalSpeed: '',
    maxVerticalSpeed: '',
    takeoffSoc: '',
    landingSoc: '',
    flightMode: '',
    flightModeIndex: null,
    hoverAccuracy: '',
    weather: '',

    // 异常与备注
    warningLog: '',
    emergencyLog: '',
    preCheckResult: '合格',
    preCheckResultIndex: 0,
    teacherComment: '',
    signatureImage: '',

    // pickers 选项源
    droneModels: [],
    missionTypes: [],
    flightModes: [],
    checkResults: [],
    airspaceCodes: ['室内实训室', '室外实训场', '校外实训场'],

    // 校验错误
    errors: {},

    // 生成中/提交中
    submitting: false,
    syncing: false,
  },

  onLoad(options) {
    const today = new Date();
    this.setData({
      flightDate: util.formatDate(today),
      droneModels: app.globalData.droneModels,
      missionTypes: app.globalData.missionTypes,
      flightModes: app.globalData.flightModes,
      checkResults: app.globalData.checkResults,
    });

    // 来自计时页：自动填充飞行日期、起飞/降落时间、总时长
    if (options && options.fromTimer) {
      const patch = {};
      if (options.flightDate) patch.flightDate = options.flightDate;
      if (options.takeoffTime) patch.takeoffTime = decodeURIComponent(options.takeoffTime);
      if (options.landingTime) patch.landingTime = decodeURIComponent(options.landingTime);
      if (options.totalDuration) patch.totalDuration = decodeURIComponent(options.totalDuration);
      if (Object.keys(patch).length) {
        this.setData(patch);
      }
    }

    // 编辑模式：从云端拉取详情
    if (options && options.id) {
      this.setData({ editId: options.id });
      wx.showLoading({ title: '加载中', mask: true });
      wx.cloud
        .callFunction({
          name: 'flylog',
          data: { action: 'detail', _id: options.id },
        })
        .then((res) => {
          wx.hideLoading();
          if (res.result && res.result.success && res.result.data) {
            const d = res.result.data;
            this.setData({
              ...d,
              droneModelIndex: this.data.droneModels.indexOf(d.droneModel),
              missionTypeIndex: this.data.missionTypes.indexOf(d.missionType),
              flightModeIndex: this.data.flightModes.indexOf(d.flightMode),
              preCheckResultIndex: this.data.checkResults.indexOf(
                d.preCheckResult,
              ),
              airspaceCodeIndex: this.data.airspaceCodes.indexOf(d.airspaceCode),
            });
          }
        })
        .catch(() => wx.hideLoading());
    } else {
      // 新建：生成日志编号
      this.genLogCode();
      // 自动预填常用信息（来自个人中心）
      const profile = wx.getStorageSync('userProfile');
      if (profile) {
        const patch = {};
        ['pilotName', 'pilotId', 'className', 'teacher'].forEach((k) => {
          if (profile[k]) patch[k] = profile[k];
        });
        if (Object.keys(patch).length) this.setData(patch);
      }
      // 恢复草稿
      const draft = wx.getStorageSync('reportDraft');
      if (draft) {
        wx.showModal({
          title: '恢复草稿',
          content: '检测到上次未提交的草稿，是否恢复？',
          success: (r) => {
            if (r.confirm) {
              this.setData({ ...draft });
            }
          },
        });
      }
    }
  },

  onUnload() {
    // 自动保存当前页面数据为草稿（若未提交）
    if (!this.data.editId) {
      wx.setStorageSync('reportDraft', this._buildDraft());
    }
  },

  // 构建草稿数据（排除时间计时相关字段，由计时页重新生成）
  _buildDraft() {
    const { errors, submitting, syncing, flightDate, takeoffTime, landingTime, totalDuration, ...rest } = this.data;
    return rest;
  },

  // 向云函数请求生成日志编号
  genLogCode() {
    wx.cloud
      .callFunction({
        name: 'flylog',
        data: { action: 'gen_code', flightDate: this.data.flightDate },
      })
      .then((res) => {
        if (res.result && res.result.success) {
          this.setData({ logCode: res.result.data.code });
        } else {
          this.setData({
            logCode: util.genLogCode(this.data.flightDate, 1),
          });
        }
      })
      .catch(() => {
        this.setData({ logCode: util.genLogCode(this.data.flightDate, 1) });
      });
  },

  onTabsChange(e) {
    this.setData({ activeTab: e.detail.value });
  },

  // ============ 表单变更 ============
  onInput(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [field]: e.detail.value });
    this.clearError(field);
  },

  onDateChange(e) {
    this.setData({ flightDate: e.detail.value });
    this.clearError('flightDate');
    // 日期变了重新生成编号
    if (!this.data.editId) this.genLogCode();
  },

  onTakeoffTimeChange(e) {
    const takeoffTime = e.detail.value + ':00';
    this.setData({ takeoffTime });
    this.recalcDuration();
    this.clearError('takeoffTime');
  },

  onLandingTimeChange(e) {
    const landingTime = e.detail.value + ':00';
    this.setData({ landingTime });
    this.recalcDuration();
    this.clearError('landingTime');
  },

  recalcDuration() {
    const { takeoffTime, landingTime } = this.data;
    if (takeoffTime && landingTime) {
      this.setData({
        totalDuration: util.diffDuration(takeoffTime, landingTime),
      });
    }
  },

  // 下拉选择 - 原生 picker
  onDroneModelPick(e) {
    const idx = Number(e.detail.value);
    this.setData({
      droneModel: this.data.droneModels[idx],
      droneModelIndex: idx,
    });
    this.clearError('droneModel');
  },

  onMissionTypePick(e) {
    const idx = Number(e.detail.value);
    this.setData({
      missionType: this.data.missionTypes[idx],
      missionTypeIndex: idx,
    });
    this.clearError('missionType');
  },

  onFlightModePick(e) {
    const idx = Number(e.detail.value);
    this.setData({
      flightMode: this.data.flightModes[idx],
      flightModeIndex: idx,
    });
    this.clearError('flightMode');
  },

  onCheckResultPick(e) {
    const idx = Number(e.detail.value);
    this.setData({
      preCheckResult: this.data.checkResults[idx],
      preCheckResultIndex: idx,
    });
    this.clearError('preCheckResult');
  },

  onAirspaceCodePick(e) {
    const idx = Number(e.detail.value);
    this.setData({
      airspaceCode: this.data.airspaceCodes[idx],
      airspaceCodeIndex: idx,
    });
    this.clearError('airspaceCode');
  },

  // 模拟同步飞控数据
  onSyncFlightData() {
    if (this.data.syncing) return;
    this.setData({ syncing: true });
    wx.showLoading({ title: '同步中', mask: true });
    setTimeout(() => {
      // Demo 数据
      this.setData({
        maxAltitude: '50.0',
        maxHorizontalSpeed: '8.5',
        maxVerticalSpeed: '3.0',
        takeoffSoc: '95',
        landingSoc: '35',
        flightMode: 'GPS',
        flightModeIndex: this.data.flightModes.indexOf('GPS'),
        hoverAccuracy: '0.5/0.3',
        weather: '3-4级风 25℃ 能见度良好',
        syncing: false,
      });
      wx.hideLoading();
      wx.showToast({ title: '同步完成', icon: 'success' });
    }, 1500);
  },

  // ============ 签名 ============
  openSignature() {
    wx.navigateTo({
      url: '/pages/signature/signature',
      events: {
        signatureReturn: (data) => {
          this.setData({ signatureImage: data.url });
        },
      },
    });
  },

  clearSignature() {
    this.setData({ signatureImage: '' });
  },

  // ============ 校验 ============
  clearError(field) {
    if (this.data.errors[field]) {
      const errors = { ...this.data.errors };
      delete errors[field];
      this.setData({ errors });
    }
  },

  validate() {
    const d = this.data;
    const errors = {};
    const required = [
      ['flightDate', '请选择飞行日期'],
      ['takeoffTime', '请选择起飞时间'],
      ['landingTime', '请选择降落时间'],
      ['pilotName', '请输入驾驶员姓名'],
      ['pilotId', '请输入学号/执照编号'],
      ['className', '请输入班级/所属单位'],
      ['droneModel', '请选择无人机型号'],
      ['bodySn', '请输入机身SN号'],
      ['batterySn', '请输入电池SN号'],
      ['missionType', '请选择飞行任务类型'],
      ['airspaceCode', '请选择空域报备编号'],
      ['maxAltitude', '请输入最大飞行高度'],
      ['maxHorizontalSpeed', '请输入最大水平速度'],
      ['maxVerticalSpeed', '请输入最大垂直速度'],
      ['takeoffSoc', '请输入起飞电量'],
      ['landingSoc', '请输入降落电量'],
      ['flightMode', '请选择飞行模式'],
      ['weather', '请输入天气情况'],
      ['warningLog', '请填写告警/故障记录，无则填「无」'],
      ['emergencyLog', '请填写应急操作记录，无则填「无」'],
      ['preCheckResult', '请选择飞行前检查结果'],
    ];
    required.forEach(([k, msg]) => {
      if (!d[k] && d[k] !== 0) errors[k] = msg;
    });

    // 数值字段校验
    const numberFields = [
      'maxAltitude',
      'maxHorizontalSpeed',
      'maxVerticalSpeed',
      'takeoffSoc',
      'landingSoc',
    ];
    numberFields.forEach((k) => {
      if (d[k] && isNaN(Number(d[k]))) errors[k] = '请输入有效数值';
    });

    if (d.preCheckResult === '不合格') {
      errors.preCheckResult = '飞行前检查不合格，禁止提交，请整改后重新检查';
    }

    return errors;
  },

  onSubmit() {
    const errors = this.validate();
    if (Object.keys(errors).length > 0) {
      this.setData({ errors });
      // 跳到第一个有错误的 Tab
      const baseFields = [
        'flightDate','takeoffTime','landingTime','pilotName','pilotId',
        'className','droneModel','bodySn','batterySn','missionType','airspaceCode',
      ];
      const dataFields = [
        'maxAltitude','maxHorizontalSpeed','maxVerticalSpeed','takeoffSoc',
        'landingSoc','flightMode','weather',
      ];
      const firstKey = Object.keys(errors)[0];
      let tab = 0;
      if (dataFields.includes(firstKey)) tab = 1;
      else if (!baseFields.includes(firstKey)) tab = 2;
      this.setData({ activeTab: tab });
      wx.showToast({ title: errors[firstKey], icon: 'none' });
      return;
    }

    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中', mask: true });

    const payload = this.buildPayload();
    const action = this.data.editId ? 'update' : 'create';
    const callData = this.data.editId
      ? { action, _id: this.data.editId, data: payload }
      : { action, data: payload };

    wx.cloud
      .callFunction({ name: 'flylog', data: callData })
      .then((res) => {
        wx.hideLoading();
        this.setData({ submitting: false });
        if (res.result && res.result.success) {
          wx.removeStorageSync('reportDraft');
          wx.showToast({ title: '提交成功', icon: 'success' });
          setTimeout(() => {
            wx.switchTab({ url: '/pages/query/query' });
          }, 800);
        } else {
          wx.showToast({
            title: (res.result && res.result.message) || '提交失败',
            icon: 'none',
          });
        }
      })
      .catch((err) => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: '网络异常，已保存为草稿', icon: 'none' });
        wx.setStorageSync('reportDraft', this._buildDraft());
      });
  },

  buildPayload() {
    const d = this.data;
    return {
      logCode: d.logCode,
      flightDate: d.flightDate,
      takeoffTime: d.takeoffTime,
      landingTime: d.landingTime,
      totalDuration: d.totalDuration,
      pilotName: d.pilotName,
      pilotId: d.pilotId,
      className: d.className,
      teacher: d.teacher,
      droneModel: d.droneModel,
      bodySn: d.bodySn,
      batterySn: d.batterySn,
      missionType: d.missionType,
      airspaceCode: d.airspaceCode,
      maxAltitude: Number(d.maxAltitude),
      maxHorizontalSpeed: Number(d.maxHorizontalSpeed),
      maxVerticalSpeed: Number(d.maxVerticalSpeed),
      takeoffSoc: Number(d.takeoffSoc),
      landingSoc: Number(d.landingSoc),
      flightMode: d.flightMode,
      hoverAccuracy: d.hoverAccuracy,
      weather: d.weather,
      warningLog: d.warningLog,
      emergencyLog: d.emergencyLog,
      preCheckResult: d.preCheckResult,
      teacherComment: d.teacherComment,
      signatureImage: d.signatureImage,
    };
  },

  onReset() {
    wx.showModal({
      title: '确认重置',
      content: '重置将清空当前填写内容，确定继续吗？',
      success: (r) => {
        if (r.confirm) {
          wx.removeStorageSync('reportDraft');
          wx.reLaunch({ url: '/pages/timer/timer' });
        }
      },
    });
  },

  onSaveDraft() {
    wx.setStorageSync('reportDraft', this._buildDraft());
    wx.showToast({ title: '草稿已保存', icon: 'success' });
  },
});

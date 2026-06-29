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

    // Tab0 基础信息
    flightDate: '',
    takeoffTime: '',
    landingTime: '',
    totalDuration: '',
    pilotName: '',
    pilotId: '',
    className: '',
    teacher: '',
    teacherIndex: null,
    teacherOpenid: '',         // 指导教师的 openid（唯一标识）
    safetyOfficer: '',
    safetyOfficerIndex: null,
    safetyOfficerOpenid: '',   // 安全员的 openid（唯一标识）
    droneModel: '',
    droneModelIndex: null,
    missionType: '',
    missionTypeIndex: null,
    // 前4个任务类型（悬停类）不需要「航线完整」评分
    showRouteIntegrity: false,
    flightMode: '',
    flightModeIndex: null,
    airspaceCode: '',
    airspaceCodeIndex: null,

    // Tab1 任务评价（1-5分，0 表示未评）
    ratingTakeoffLanding: 0,
    ratingDriftRange: 0,
    ratingDriftAltitude: 0,
    ratingRouteIntegrity: 0,

    // Tab2 异常与备注
    teacherComment: '',
    signatureImage: '',

    // pickers 选项源
    droneModels: [],
    missionTypes: [],
    flightModes: [],
    airspaceCodes: ['室内实训室', '室外实训场', '校外实训场'],
    instructorList: [],   // 指导教师列表（role=instructor）
    personnelList: [],    // 全体人员列表（非 admin，用于安全员选择）

    // 校验错误
    errors: {},

    // 提交中
    submitting: false,
  },

  onLoad(options) {
    const today = new Date();
    this.setData({
      flightDate: util.formatDate(today),
      droneModels: app.globalData.droneModels,
      missionTypes: app.globalData.missionTypes,
      flightModes: app.globalData.flightModes,
    });

    // 异步拉取人员列表
    this.fetchPersonnel();

    // 来自计时页：自动填充飞行日期、起飞/降落时间、总时长，以及预填字段
    if (options && options.fromTimer) {
      /** @type {Record<string, any>} */
      const patch = {};
      if (options.flightDate) patch.flightDate = options.flightDate;
      if (options.takeoffTime) patch.takeoffTime = decodeURIComponent(options.takeoffTime);
      if (options.landingTime) patch.landingTime = decodeURIComponent(options.landingTime);
      if (options.totalDuration) patch.totalDuration = decodeURIComponent(options.totalDuration);
      if (options.droneModel) {
        const model = decodeURIComponent(options.droneModel);
        patch.droneModel = model;
        patch.droneModelIndex = this.data.droneModels.indexOf(model);
      }
      if (options.missionType) {
        const mission = decodeURIComponent(options.missionType);
        patch.missionType = mission;
        const missionIdx = this.data.missionTypes.indexOf(mission);
        patch.missionTypeIndex = missionIdx;
        patch.showRouteIntegrity = missionIdx >= 4;
      }
      if (options.flightMode) {
        const mode = decodeURIComponent(options.flightMode);
        patch.flightMode = mode;
        patch.flightModeIndex = this.data.flightModes.indexOf(mode);
      }
      if (options.airspaceCode) {
        const code = decodeURIComponent(options.airspaceCode);
        patch.airspaceCode = code;
        patch.airspaceCodeIndex = this.data.airspaceCodes.indexOf(code);
      }
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
            const missionTypeIndex = this.data.missionTypes.indexOf(d.missionType);
            this.setData({
              ...d,
              droneModelIndex: this.data.droneModels.indexOf(d.droneModel),
              missionTypeIndex,
              showRouteIntegrity: missionTypeIndex >= 4,
              flightModeIndex: this.data.flightModes.indexOf(d.flightMode),
              airspaceCodeIndex: this.data.airspaceCodes.indexOf(d.airspaceCode),
              teacherIndex: this.data.instructorList.findIndex(
                (p) => d.teacherOpenid ? p.openid === d.teacherOpenid : p.realName === d.teacher,
              ),
              safetyOfficerIndex: this.data.personnelList.findIndex(
                (p) => d.safetyOfficerOpenid ? p.openid === d.safetyOfficerOpenid : p.realName === d.safetyOfficer,
              ),
              teacherOpenid: d.teacherOpenid || '',
              safetyOfficerOpenid: d.safetyOfficerOpenid || '',
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
        ['pilotName', 'pilotId', 'className'].forEach((k) => {
          if (profile[k]) patch[k] = profile[k];
        });
        if (Object.keys(patch).length) this.setData(patch);
      }
    }
  },

  // 拉取人员列表：instructorList 仅含教师，personnelList 含所有非管理员
  fetchPersonnel() {
    wx.cloud
      .callFunction({ name: 'flylog', data: { action: 'list_personnel' } })
      .then((res) => {
        if (res.result && res.result.success) {
          const all = res.result.data || [];
          this.setData({
            instructorList: all.filter((p) => p.role === 'instructor'),
            personnelList: all,
          });
        }
      })
      .catch(() => {});
  },

  // 生成日志编号
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
          this.setData({ logCode: util.genLogCode(this.data.flightDate, 1) });
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
      this.setData({ totalDuration: util.diffDuration(takeoffTime, landingTime) });
    }
  },

  // ============ Picker 事件 ============
  onDroneModelPick(e) {
    const idx = Number(e.detail.value);
    this.setData({ droneModel: this.data.droneModels[idx], droneModelIndex: idx });
    this.clearError('droneModel');
  },

  onMissionTypePick(e) {
    const idx = Number(e.detail.value);
    const showRouteIntegrity = idx >= 4;
    this.setData({
      missionType: this.data.missionTypes[idx],
      missionTypeIndex: idx,
      showRouteIntegrity,
      // 切换到悬停类任务时清空航线完整评分
      ratingRouteIntegrity: showRouteIntegrity ? this.data.ratingRouteIntegrity : 0,
    });
    this.clearError('missionType');
    if (!showRouteIntegrity) this.clearError('ratingRouteIntegrity');
  },

  onFlightModePick(e) {
    const idx = Number(e.detail.value);
    this.setData({ flightMode: this.data.flightModes[idx], flightModeIndex: idx });
    this.clearError('flightMode');
  },

  onAirspaceCodePick(e) {
    const idx = Number(e.detail.value);
    this.setData({ airspaceCode: this.data.airspaceCodes[idx], airspaceCodeIndex: idx });
    this.clearError('airspaceCode');
  },

  onTeacherPick(e) {
    const idx = Number(e.detail.value);
    const person = this.data.instructorList[idx];
    this.setData({
      teacher: person ? person.realName : '',
      teacherOpenid: person ? (person.openid || '') : '',
      teacherIndex: idx,
    });
    this.clearError('teacher');
  },

  onSafetyOfficerPick(e) {
    const idx = Number(e.detail.value);
    const person = this.data.personnelList[idx];
    this.setData({
      safetyOfficer: person ? person.realName : '',
      safetyOfficerOpenid: person ? (person.openid || '') : '',
      safetyOfficerIndex: idx,
    });
    this.clearError('safetyOfficer');
  },

  // 任务评价评分
  onRatingChange(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [field]: e.detail.value });
    this.clearError(field);
  },

  // ============ 签名 ============
  openSignature() {
    wx.navigateTo({
      url: '/pages/signature/signature',
      events: {
        signatureReturn: (data) => {
          this.setData({ signatureImage: data.url });
          this.clearError('signatureImage');
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

    // Tab0 必填
    const baseRequired = [
      ['flightDate', '请选择飞行日期'],
      ['takeoffTime', '请选择起飞时间'],
      ['landingTime', '请选择降落时间'],
      ['pilotName', '请输入驾驶员姓名'],
      ['pilotId', '请输入学号/执照编号'],
      ['className', '请输入班级/所属单位'],
      ['teacher', '请选择指导教师'],
      ['safetyOfficer', '请选择安全员'],
      ['droneModel', '请选择无人机型号'],
      ['missionType', '请选择飞行任务类型'],
      ['flightMode', '请选择飞行模式'],
      ['airspaceCode', '请选择空域报备编号'],
    ];
    baseRequired.forEach(([k, msg]) => {
      if (!d[k]) errors[k] = msg;
    });

    // Tab1 评分必填（0 为未评）
    const ratingRequired = [
      ['ratingTakeoffLanding', '请为「起降」打分'],
      ['ratingDriftRange', '请为「范围漂移」打分'],
      ['ratingDriftAltitude', '请为「高度漂移」打分'],
    ];
    ratingRequired.forEach(([k, msg]) => {
      if (!d[k]) errors[k] = msg;
    });
    // 航线完整仅第5个及之后的任务类型（missionTypeIndex >= 4）需要评分
    const needRouteIntegrity = d.missionTypeIndex !== null && d.missionTypeIndex >= 4;
    if (needRouteIntegrity && !d.ratingRouteIntegrity) {
      errors.ratingRouteIntegrity = '请为「航线完整」打分';
    }

    // Tab2 签名必填
    if (!d.signatureImage) {
      errors.signatureImage = '请完成记录人电子签名';
    }

    return errors;
  },

  onSubmit() {
    const errors = this.validate();
    if (Object.keys(errors).length > 0) {
      this.setData({ errors });
      const baseFields = [
        'flightDate', 'takeoffTime', 'landingTime', 'pilotName', 'pilotId',
        'className', 'teacher', 'safetyOfficer', 'droneModel', 'missionType', 'flightMode', 'airspaceCode',
      ];
      const ratingFields = [
        'ratingTakeoffLanding', 'ratingDriftRange', 'ratingDriftAltitude', 'ratingRouteIntegrity',
      ];
      const firstKey = Object.keys(errors)[0];
      let tab = 0;
      if (ratingFields.includes(firstKey)) tab = 1;
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
          wx.showModal({
            title: '提交成功',
            content: '日志已提交，正在等待安全员审批。审批通过后将显示在日志查询中。',
            showCancel: false,
            confirmText: '知道了',
            success: () => {
              wx.switchTab({ url: '/pages/query/query' });
            },
          });
        } else {
          wx.showToast({
            title: (res.result && res.result.message) || '提交失败',
            icon: 'none',
          });
        }
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ submitting: false });
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
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
      teacherOpenid: d.teacherOpenid || '',
      safetyOfficer: d.safetyOfficer,
      safetyOfficerOpenid: d.safetyOfficerOpenid || '',
      droneModel: d.droneModel,
      missionType: d.missionType,
      flightMode: d.flightMode,
      airspaceCode: d.airspaceCode,
      ratingTakeoffLanding: d.ratingTakeoffLanding,
      ratingDriftRange: d.ratingDriftRange,
      ratingDriftAltitude: d.ratingDriftAltitude,
      // 悬停类任务（前4个）不需要航线完整评分，强制存0
      ratingRouteIntegrity: (d.missionTypeIndex !== null && d.missionTypeIndex >= 4) ? d.ratingRouteIntegrity : 0,
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
          wx.reLaunch({ url: '/pages/timer/timer' });
        }
      },
    });
  },
});

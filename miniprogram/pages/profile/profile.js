// pages/profile/profile.js
const DEFAULT_AVATAR =
  'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

// 角色选项：显示名 -> 云端 role 值
const ROLE_OPTIONS = ['学员', '指导教师', '安全员'];
const ROLE_VALUES = ['student', 'instructor', 'safety_officer'];

// 各角色对应的标签文案
const ID_LABEL_MAP = {
  student: '学号',
  instructor: '教师编号',
  safety_officer: '编号',
};

Page({
  data: {
    defaultAvatar: DEFAULT_AVATAR,
    userInfo: {
      avatarUrl: '',
      nickName: '',
    },

    // 身份注册相关
    roleOptions: ROLE_OPTIONS,
    roleIndex: 0,          // picker 当前选中下标
    role: 'student',       // 当前角色值
    idLabel: '学号',        // 编号字段标签（随角色变化）

    // 注册信息表单
    reg: {
      realName: '',   // 姓名
      studentId: '',  // 学号/编号
      phone: '',      // 联系方式
      className: '',  // 班级/单位
    },

    // 是否已完成注册（云端有记录）
    registered: false,
    // 是否处于编辑态（未注册时默认 true，已注册后默认 false）
    editing: true,
    // 保存中
    saving: false,

    hasDraft: false,
    editingNickname: false,
    isAdmin: false,
    openid: '',
  },

  onShow() {
    const userInfo = wx.getStorageSync('userInfo') || { avatarUrl: '', nickName: '' };
    const hasDraft = !!wx.getStorageSync('reportDraft');
    this.setData({ userInfo, hasDraft });
    this.fetchUserInfo();
  },

  // 从云端拉取用户完整信息
  fetchUserInfo() {
    wx.showLoading({ title: '加载中', mask: false });
    wx.cloud
      .callFunction({ name: 'flylog', data: { action: 'who_am_i' } })
      .then((res) => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          const d = res.result.data;
          const roleValue = d.role || 'student';
          const roleIdx = ROLE_VALUES.indexOf(roleValue);
          const safeIdx = roleIdx >= 0 ? roleIdx : 0;

          this.setData({
            isAdmin: !!d.isAdmin,
            openid: d.openid || '',
            registered: !!d.registered,
            editing: !d.registered,   // 已注册则只读，未注册则可编辑
            role: roleValue,
            roleIndex: safeIdx,
            idLabel: ID_LABEL_MAP[roleValue] || '编号',
            reg: {
              realName: d.realName || '',
              studentId: d.studentId || '',
              phone: d.phone || '',
              className: d.className || '',
            },
          });

          // 同步本地 userProfile 供填报页预填
          if (d.registered) {
            wx.setStorageSync('userProfile', {
              pilotName: d.realName || '',
              pilotId: d.studentId || '',
              className: d.className || '',
              teacher: '',
            });
          }
        }
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '加载失败，请重试', icon: 'none' });
      });
  },

  // 角色下拉选择
  onRolePick(e) {
    const idx = Number(e.detail.value);
    const roleValue = ROLE_VALUES[idx];
    this.setData({
      roleIndex: idx,
      role: roleValue,
      idLabel: ID_LABEL_MAP[roleValue] || '编号',
    });
  },

  // 注册表单输入
  onRegInput(e) {
    const { field } = e.currentTarget.dataset;
    const reg = { ...this.data.reg, [field]: e.detail.value };
    this.setData({ reg });
  },

  // 点击「更新信息」进入编辑态
  startEditing() {
    this.setData({ editing: true });
  },

  // 保存/更新注册信息
  saveProfile() {
    const { reg, userInfo } = this.data;
    if (!reg.realName.trim()) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    if (!reg.studentId.trim()) {
      wx.showToast({ title: `请填写${this.data.idLabel}`, icon: 'none' });
      return;
    }
    if (!reg.className.trim()) {
      wx.showToast({ title: '请填写班级/单位', icon: 'none' });
      return;
    }

    if (this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });

    wx.cloud
      .callFunction({
        name: 'flylog',
        data: {
          action: 'upsert_user',
          data: {
            nickName: userInfo.nickName || '',
            avatarUrl: userInfo.avatarUrl || '',
            realName: reg.realName.trim(),
            studentId: reg.studentId.trim(),
            phone: reg.phone.trim(),
            className: reg.className.trim(),
            // 注意：role 由管理员设置，普通用户首次注册时默认 student；
            // 此处前端传 requestedRole 仅用于首次注册时写入（云函数默认 student）
            // 若需支持前端自选角色写入，需云函数侧配合开放；
            // 当前云函数 upsert_user 不接受 role 参数，首次默认 student
          },
        },
      })
      .then((res) => {
        wx.hideLoading();
        this.setData({ saving: false });
        if (res.result && res.result.success) {
          this.setData({ registered: true, editing: false });
          wx.showToast({ title: '保存成功', icon: 'success' });
          // 更新本地预填缓存
          wx.setStorageSync('userProfile', {
            pilotName: reg.realName.trim(),
            pilotId: reg.studentId.trim(),
            className: reg.className.trim(),
            teacher: '',
          });
        } else {
          wx.showToast({
            title: (res.result && res.result.message) || '保存失败',
            icon: 'none',
          });
        }
      })
      .catch(() => {
        wx.hideLoading();
        this.setData({ saving: false });
        wx.showToast({ title: '网络异常，请重试', icon: 'none' });
      });
  },

  // 复制 OpenID
  copyOpenid() {
    if (!this.data.openid) return;
    wx.setClipboardData({
      data: this.data.openid,
      success: () => wx.showToast({ title: '已复制 OpenID', icon: 'success' }),
    });
  },

  // 选择头像
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    const userInfo = { ...this.data.userInfo, avatarUrl };
    this.setData({ userInfo });
    wx.setStorageSync('userInfo', userInfo);
  },

  onAvatarTap() {},

  startEditNickname() {
    this.setData({ editingNickname: true });
    setTimeout(() => {
      this.setData({ nicknameFocus: true });
    }, 50);
  },

  onNicknameInput(e) {
    const userInfo = { ...this.data.userInfo, nickName: e.detail.value };
    this.setData({ userInfo });
  },

  onNicknameBlur(e) {
    const nickName = (e.detail.value || '').trim();
    const userInfo = { ...this.data.userInfo, nickName };
    this.setData({ userInfo, editingNickname: false });
    wx.setStorageSync('userInfo', userInfo);
  },

  clearUserInfo() {
    wx.showModal({
      title: '清除信息',
      content: '将清空当前头像与昵称，确定吗？',
      success: (r) => {
        if (r.confirm) {
          const userInfo = { avatarUrl: '', nickName: '' };
          this.setData({ userInfo, editingNickname: false });
          wx.setStorageSync('userInfo', userInfo);
        }
      },
    });
  },

  clearDraft() {
    wx.showModal({
      title: '清除草稿',
      content: '将清空本地未提交的草稿，确定吗？',
      success: (r) => {
        if (r.confirm) {
          wx.removeStorageSync('reportDraft');
          this.setData({ hasDraft: false });
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      },
    });
  },

  goReport() {
    wx.switchTab({ url: '/pages/report/report' });
  },

  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' });
  },
});

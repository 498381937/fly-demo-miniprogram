// 云函数入口：飞行日志相关操作
// 支持的 action：
//   - who_am_i        获取当前用户信息（含角色）
//   - upsert_user     注册/更新当前用户信息（首次登录自动调用）
//   - get_user        获取指定用户信息（管理员可查任意用户）
//   - list_users      查询用户列表（仅管理员）
//   - set_user_role   设置用户角色（仅管理员）
//   - gen_code        生成日志编号（FLY-YYYYMMDD-NNN）
//   - create          创建日志
//   - update          更新日志（管理员可改任意记录；普通用户只能改自己）
//   - remove          删除日志（管理员可删任意记录；普通用户只能删自己）
//   - detail          查询日志详情（管理员可查任意记录；普通用户只能查自己）
//   - list            查询日志列表（scope=all 需管理员，默认 mine）
//   - stats           统计数据（scope=all 需管理员，默认 mine）
//   - list_admins     列出所有管理员（管理员可用，兼容旧版）
//   - add_admin       添加管理员（管理员可用，兼容旧版）
//   - remove_admin    移除管理员（管理员可用，不能删自己，兼容旧版）

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = 'flight_logs';
const ADMIN_COLLECTION = 'admins';
const USER_COLLECTION = 'users';

// 合法角色枚举
// admin          - 管理员
// student        - 学员
// instructor     - 指导教师
// safety_officer - 安全员
const VALID_ROLES = ['admin', 'student', 'instructor', 'safety_officer'];

const pad = (n) => (n < 10 ? '0' + n : '' + n);

function formatDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function hmsToSeconds(hms) {
  if (!hms) return 0;
  const parts = hms.split(':').map(Number);
  return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
}

// 判断错误是否为「集合不存在」
function isCollectionNotExistError(err) {
  if (!err) return false;
  const msg = (err.errMsg || err.message || '') + '';
  return (
    err.errCode === -502005 ||
    msg.includes('-502005') ||
    msg.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    msg.includes('not exist') ||
    msg.includes('collection not exists')
  );
}

// 尝试创建集合；若已存在则忽略
async function ensureCollection(name) {
  try {
    if (typeof db.createCollection === 'function') {
      await db.createCollection(name);
      return;
    }
  } catch (err) {
    if (isCollectionNotExistError(err)) return;
    const msg = (err.errMsg || err.message || '') + '';
    if (msg.includes('ALREADY_EXISTS') || msg.includes('already exist')) return;
    console.warn(`[flylog] createCollection(${name}) warn:`, msg);
  }
}

// 判断 openid 是否管理员：优先查 users 集合，兼容旧 admins 集合
async function isAdmin(openid) {
  if (!openid) return false;
  try {
    // 先查新 users 集合
    const res = await db
      .collection(USER_COLLECTION)
      .where({ openid, role: 'admin', status: 'active' })
      .limit(1)
      .get();
    if (res.data.length > 0) return true;
  } catch (err) {
    if (!isCollectionNotExistError(err)) {
      console.warn('[flylog] isAdmin users query failed:', err.message || err);
    }
  }
  // 兼容旧 admins 集合
  try {
    const res = await db
      .collection(ADMIN_COLLECTION)
      .where({ openid })
      .limit(1)
      .get();
    return res.data.length > 0;
  } catch (err) {
    if (isCollectionNotExistError(err)) return false;
    console.warn('[flylog] isAdmin admins query failed:', err.message || err);
    return false;
  }
}

// 获取用户完整信息（含角色）；未注册返回 null
async function getUserInfo(openid) {
  if (!openid) return null;
  try {
    const res = await db
      .collection(USER_COLLECTION)
      .where({ openid })
      .limit(1)
      .get();
    return res.data[0] || null;
  } catch (err) {
    if (isCollectionNotExistError(err)) return null;
    throw err;
  }
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const action = event.action;

  try {
    switch (action) {
      case 'who_am_i':
        return await whoAmI(OPENID);
      case 'upsert_user':
        return await upsertUser(event, OPENID);
      case 'get_user':
        return await getUser(event, OPENID);
      case 'list_users':
        return await listUsers(event, OPENID);
      case 'set_user_role':
        return await setUserRole(event, OPENID);
      case 'gen_code':
        return await genCode(event);
      case 'create':
        return await create(event, OPENID);
      case 'update':
        return await update(event, OPENID);
      case 'remove':
        return await remove(event, OPENID);
      case 'detail':
        return await detail(event, OPENID);
      case 'list':
        return await list(event, OPENID);
      case 'stats':
        return await stats(event, OPENID);
      case 'list_admins':
        return await listAdmins(OPENID);
      case 'add_admin':
        return await addAdmin(event, OPENID);
      case 'remove_admin':
        return await removeAdmin(event, OPENID);
      default:
        return { success: false, message: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error('[flylog] error:', err);
    return { success: false, message: err.message || '云函数执行失败' };
  }
};

// ============ 用户信息 ============
async function whoAmI(openid) {
  const [admin, userDoc] = await Promise.all([
    isAdmin(openid),
    getUserInfo(openid),
  ]);
  return {
    success: true,
    data: {
      openid,
      isAdmin: admin,
      role: userDoc ? userDoc.role : null,
      status: userDoc ? userDoc.status : null,
      nickName: userDoc ? userDoc.nickName : null,
      realName: userDoc ? userDoc.realName : null,
      avatarUrl: userDoc ? userDoc.avatarUrl : null,
      studentId: userDoc ? userDoc.studentId : null,
      phone: userDoc ? userDoc.phone : null,
      className: userDoc ? userDoc.className : null,
      registered: !!userDoc,
    },
  };
}

// ============ 注册 / 更新当前用户 ============
// 前端在用户首次进入小程序时调用，传入微信授权的用户基础信息。
// 若该 openid 已存在，则仅更新允许自改的字段（nickName / avatarUrl / realName / studentId / phone / className）。
// 角色（role）和状态（status）只有管理员能通过 set_user_role 修改，此处不接受。
async function upsertUser(event, openid) {
  const {
    nickName = '',
    avatarUrl = '',
    realName = '',
    studentId = '',
    phone = '',
    className = '',
  } = event.data || {};

  const now = db.serverDate();
  let existing = null;

  try {
    const res = await db
      .collection(USER_COLLECTION)
      .where({ openid })
      .limit(1)
      .get();
    existing = res.data[0] || null;
  } catch (err) {
    if (!isCollectionNotExistError(err)) throw err;
  }

  if (existing) {
    // 已注册：仅更新自改字段
    const updateData = { updateTime: now };
    if (nickName) updateData.nickName = nickName;
    if (avatarUrl) updateData.avatarUrl = avatarUrl;
    if (realName) updateData.realName = realName;
    if (studentId) updateData.studentId = studentId;
    if (phone) updateData.phone = phone;
    if (className) updateData.className = className;

    await db
      .collection(USER_COLLECTION)
      .where({ openid })
      .update({ data: updateData });

    return { success: true, data: { _id: existing._id, created: false } };
  }

  // 首次注册：写入完整记录，默认角色为学员（student）
  const payload = {
    openid,
    nickName,
    avatarUrl,
    realName,
    studentId,
    phone,
    className,
    role: 'student',   // 默认角色，管理员可通过 set_user_role 变更
    status: 'active',
    createTime: now,
    updateTime: now,
  };

  let res;
  try {
    res = await db.collection(USER_COLLECTION).add({ data: payload });
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      await ensureCollection(USER_COLLECTION);
      res = await db.collection(USER_COLLECTION).add({ data: payload });
    } else {
      throw err;
    }
  }

  return { success: true, data: { _id: res._id, created: true } };
}

// ============ 查询指定用户信息 ============
// 普通用户只能查自己；管理员可通过 targetOpenid 查任意用户。
async function getUser(event, openid) {
  const admin = await isAdmin(openid);
  const targetOpenid = (admin && event.targetOpenid) ? event.targetOpenid : openid;

  const doc = await getUserInfo(targetOpenid);
  if (!doc) return { success: false, message: '用户不存在' };
  return { success: true, data: doc };
}

// ============ 查询用户列表（仅管理员）============
// 支持按 role / status / keyword 筛选，支持分页。
async function listUsers(event, openid) {
  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限' };

  const {
    role = '',       // 按角色筛选，空则不限
    status = '',     // 按状态筛选，空则不限
    keyword = '',    // 模糊匹配 nickName / realName / studentId
    pageSize = 20,
    pageIndex = 0,
  } = event;

  const andConds = [];
  if (role && VALID_ROLES.includes(role)) andConds.push({ role });
  if (status) andConds.push({ status });
  if (keyword) {
    const reg = db.RegExp({ regexp: keyword, options: 'i' });
    andConds.push(
      _.or([{ nickName: reg }, { realName: reg }, { studentId: reg }, { phone: reg }]),
    );
  }

  const whereClause =
    andConds.length === 0
      ? {}
      : andConds.length === 1
      ? andConds[0]
      : _.and(andConds);

  const emptyResult = {
    success: true,
    data: { list: [], total: 0, pageIndex, pageSize, hasMore: false },
  };

  let countRes;
  try {
    countRes = await db.collection(USER_COLLECTION).where(whereClause).count();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  let res;
  try {
    res = await db
      .collection(USER_COLLECTION)
      .where(whereClause)
      .orderBy('createTime', 'desc')
      .skip(pageIndex * pageSize)
      .limit(pageSize)
      .get();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  return {
    success: true,
    data: {
      list: res.data,
      total: countRes.total,
      pageIndex,
      pageSize,
      hasMore: (pageIndex + 1) * pageSize < countRes.total,
    },
  };
}

// ============ 设置用户角色 / 状态（仅管理员）============
// 支持同时修改 role 和 status；至少传一个。
// 管理员不能变更自己的角色（防止误操作丢失权限）。
async function setUserRole(event, openid) {
  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限' };

  const targetOpenid = (event.targetOpenid || '').trim();
  if (!targetOpenid) return { success: false, message: '缺少 targetOpenid' };
  if (targetOpenid === openid) return { success: false, message: '不能变更自己的角色' };

  const { role, status } = event;
  if (role === undefined && status === undefined) {
    return { success: false, message: '至少需要提供 role 或 status' };
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return {
      success: false,
      message: `无效角色，合法值为：${VALID_ROLES.join(' / ')}`,
    };
  }
  if (status !== undefined && !['active', 'disabled'].includes(status)) {
    return { success: false, message: '无效状态，合法值为：active / disabled' };
  }

  // 检查目标用户是否存在
  const existing = await getUserInfo(targetOpenid);
  if (!existing) return { success: false, message: '目标用户不存在，请先让其注册' };

  const updateData = { updateTime: db.serverDate() };
  if (role !== undefined) updateData.role = role;
  if (status !== undefined) updateData.status = status;

  await db
    .collection(USER_COLLECTION)
    .where({ openid: targetOpenid })
    .update({ data: updateData });

  return { success: true, data: { targetOpenid, ...updateData } };
}

// ============ 生成日志编号 ============
async function genCode(event) {
  const flightDate = event.flightDate || new Date();
  const dateKey = formatDateKey(flightDate);

  const { OPENID } = cloud.getWXContext();
  let total = 0;
  try {
    const countRes = await db
      .collection(COLLECTION)
      .where({ _openid: OPENID, dateKey })
      .count();
    total = countRes.total || 0;
  } catch (err) {
    if (!isCollectionNotExistError(err)) throw err;
    total = 0;
  }

  const nextIndex = total + 1;
  const code = `FLY-${dateKey}-${String(nextIndex).padStart(3, '0')}`;
  return { success: true, data: { code, index: nextIndex, dateKey } };
}

// ============ 创建日志 ============
async function create(event, openid) {
  const data = event.data || {};
  const now = db.serverDate();

  const requiredFields = [
    'flightDate',
    'takeoffTime',
    'landingTime',
    'pilotName',
    'pilotId',
    'className',
    'droneModel',
    'bodySn',
    'batterySn',
    'missionType',
    'takeoffLocation',
    'landingLocation',
    'airspaceCode',
    'preCheckResult',
  ];
  for (const f of requiredFields) {
    if (data[f] === undefined || data[f] === null || data[f] === '') {
      return { success: false, message: `字段 ${f} 不能为空` };
    }
  }

  const dateKey = formatDateKey(data.flightDate);
  let logCode = data.logCode;
  if (!logCode) {
    const gen = await genCode({ flightDate: data.flightDate });
    logCode = gen.data.code;
  }

  const durationSeconds = hmsToSeconds(data.totalDuration);

  const payload = {
    ...data,
    _openid: openid, // 云函数写入时需手动注入 _openid
    logCode,
    dateKey,
    durationSeconds,
    createTime: now,
    updateTime: now,
  };

  let res;
  try {
    res = await db.collection(COLLECTION).add({ data: payload });
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      await ensureCollection(COLLECTION);
      res = await db.collection(COLLECTION).add({ data: payload });
    } else {
      throw err;
    }
  }

  return { success: true, data: { _id: res._id, logCode } };
}

// ============ 更新日志 ============
async function update(event, openid) {
  const { _id, data } = event;
  if (!_id) return { success: false, message: '缺少 _id' };

  const admin = await isAdmin(openid);

  const updateData = { ...data, updateTime: db.serverDate() };
  if (data && data.totalDuration) {
    updateData.durationSeconds = hmsToSeconds(data.totalDuration);
  }
  if (data && data.flightDate) {
    updateData.dateKey = formatDateKey(data.flightDate);
  }
  // 防止被恶意篡改所属用户
  delete updateData._openid;
  delete updateData._id;

  const where = admin ? { _id } : { _id, _openid: openid };

  try {
    const res = await db.collection(COLLECTION).where(where).update({
      data: updateData,
    });
    if (!res.stats || res.stats.updated === 0) {
      return { success: false, message: '记录不存在或无权修改' };
    }
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      return { success: false, message: '记录不存在' };
    }
    throw err;
  }

  return { success: true };
}

// ============ 删除日志 ============
async function remove(event, openid) {
  const { _id } = event;
  if (!_id) return { success: false, message: '缺少 _id' };

  const admin = await isAdmin(openid);
  const where = admin ? { _id } : { _id, _openid: openid };

  try {
    const res = await db.collection(COLLECTION).where(where).remove();
    return { success: true, data: res.stats };
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      return { success: true, data: { removed: 0 } };
    }
    throw err;
  }
}

// ============ 日志详情 ============
async function detail(event, openid) {
  const { _id } = event;
  if (!_id) return { success: false, message: '缺少 _id' };

  const admin = await isAdmin(openid);
  const where = admin ? { _id } : { _id, _openid: openid };

  try {
    const res = await db.collection(COLLECTION).where(where).get();
    return { success: true, data: res.data[0] || null };
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      return { success: true, data: null };
    }
    throw err;
  }
}

// ============ 日志列表 ============
// scope: 'mine'（默认）| 'all'（仅管理员可用）
// ownerOpenid: 管理员可指定查看某个用户的日志
async function list(event, openid) {
  const {
    keyword = '',
    startDate = '',
    endDate = '',
    pageSize = 20,
    pageIndex = 0,
    scope = 'mine',
    ownerOpenid = '',
  } = event;

  const admin = await isAdmin(openid);

  // 决定 openid 过滤条件
  const andConds = [];
  if (scope === 'all' && admin) {
    // 管理员查所有：不加 _openid 过滤
    if (ownerOpenid) {
      andConds.push({ _openid: ownerOpenid });
    }
  } else {
    // 普通用户 / 未登录管理员特权：只看自己
    andConds.push({ _openid: openid });
  }

  if (keyword) {
    const reg = db.RegExp({ regexp: keyword, options: 'i' });
    andConds.push(
      _.or([
        { logCode: reg },
        { pilotName: reg },
        { droneModel: reg },
        { missionType: reg },
        { className: reg },
      ]),
    );
  }

  if (startDate && endDate) {
    andConds.push({ flightDate: _.gte(startDate).and(_.lte(endDate)) });
  } else if (startDate) {
    andConds.push({ flightDate: _.gte(startDate) });
  } else if (endDate) {
    andConds.push({ flightDate: _.lte(endDate) });
  }

  const whereClause =
    andConds.length === 0
      ? {} // scope=all 且无其它条件
      : andConds.length === 1
      ? andConds[0]
      : _.and(andConds);

  const emptyResult = {
    success: true,
    data: {
      list: [],
      total: 0,
      pageIndex,
      pageSize,
      hasMore: false,
      isAdmin: admin,
      scope,
    },
  };

  let countRes;
  try {
    countRes = await db.collection(COLLECTION).where(whereClause).count();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  // 管理员查 all 时，展示更多字段（包括 _openid，用于区分所属用户）
  const fieldSpec = {
    logCode: true,
    flightDate: true,
    takeoffTime: true,
    landingTime: true,
    totalDuration: true,
    pilotName: true,
    className: true,
    droneModel: true,
    missionType: true,
    preCheckResult: true,
    createTime: true,
  };
  if (admin) fieldSpec._openid = true;

  let res;
  try {
    res = await db
      .collection(COLLECTION)
      .where(whereClause)
      .orderBy('flightDate', 'desc')
      .orderBy('createTime', 'desc')
      .skip(pageIndex * pageSize)
      .limit(pageSize)
      .field(fieldSpec)
      .get();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  return {
    success: true,
    data: {
      list: res.data,
      total: countRes.total,
      pageIndex,
      pageSize,
      hasMore: (pageIndex + 1) * pageSize < countRes.total,
      isAdmin: admin,
      scope: scope === 'all' && admin ? 'all' : 'mine',
    },
  };
}

// ============ 数据统计 ============
async function stats(event, openid) {
  const { scope = 'mine', ownerOpenid = '' } = event || {};
  const admin = await isAdmin(openid);

  // 根据身份决定匹配条件
  let matchCond = { _openid: openid };
  if (scope === 'all' && admin) {
    matchCond = ownerOpenid ? { _openid: ownerOpenid } : {};
  }

  // 近 5 天日期列表
  const today = new Date();
  const dates = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000);
    dates.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }

  const emptyResult = {
    success: true,
    data: {
      totalFlights: 0,
      totalDurationSeconds: 0,
      modelDistribution: [],
      missionDistribution: [],
      daily: dates.map((d) => ({ date: d, count: 0, duration: 0 })),
      isAdmin: admin,
      scope: scope === 'all' && admin ? 'all' : 'mine',
    },
  };

  let totalRes;
  try {
    totalRes = await db.collection(COLLECTION).where(matchCond).count();
  } catch (err) {
    if (isCollectionNotExistError(err)) return emptyResult;
    throw err;
  }

  if (!totalRes.total) {
    return emptyResult;
  }

  const $ = db.command.aggregate;

  const safeAggregate = async (runner) => {
    try {
      return await runner();
    } catch (err) {
      if (isCollectionNotExistError(err)) return { list: [] };
      throw err;
    }
  };

  const durationAgg = await safeAggregate(() =>
    db
      .collection(COLLECTION)
      .aggregate()
      .match(matchCond)
      .group({ _id: null, total: $.sum('$durationSeconds') })
      .end(),
  );

  const modelAgg = await safeAggregate(() =>
    db
      .collection(COLLECTION)
      .aggregate()
      .match(matchCond)
      .group({
        _id: '$droneModel',
        count: $.sum(1),
        duration: $.sum('$durationSeconds'),
      })
      .end(),
  );

  const missionAgg = await safeAggregate(() =>
    db
      .collection(COLLECTION)
      .aggregate()
      .match(matchCond)
      .group({ _id: '$missionType', count: $.sum(1) })
      .end(),
  );

  const dailyAgg = await safeAggregate(() =>
    db
      .collection(COLLECTION)
      .aggregate()
      .match({ ...matchCond, flightDate: db.command.in(dates) })
      .group({
        _id: '$flightDate',
        count: $.sum(1),
        duration: $.sum('$durationSeconds'),
      })
      .end(),
  );

  const dailyMap = {};
  (dailyAgg.list || []).forEach((d) => {
    dailyMap[d._id] = d;
  });
  const daily = dates.map((d) => ({
    date: d,
    count: dailyMap[d] ? dailyMap[d].count : 0,
    duration: dailyMap[d] ? dailyMap[d].duration : 0,
  }));

  return {
    success: true,
    data: {
      totalFlights: totalRes.total,
      totalDurationSeconds:
        durationAgg.list && durationAgg.list[0]
          ? durationAgg.list[0].total
          : 0,
      modelDistribution: modelAgg.list || [],
      missionDistribution: missionAgg.list || [],
      daily,
      isAdmin: admin,
      scope: scope === 'all' && admin ? 'all' : 'mine',
    },
  };
}

// ============ 管理员管理 ============
async function listAdmins(openid) {
  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限' };

  try {
    const res = await db
      .collection(ADMIN_COLLECTION)
      .orderBy('createTime', 'asc')
      .limit(100)
      .get();
    return { success: true, data: res.data };
  } catch (err) {
    if (isCollectionNotExistError(err)) return { success: true, data: [] };
    throw err;
  }
}

async function addAdmin(event, openid) {
  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限' };

  const target = (event.openid || '').trim();
  const name = (event.name || '').trim();
  if (!target) return { success: false, message: '缺少 openid' };

  // 幂等：已存在则直接返回成功
  try {
    const existing = await db
      .collection(ADMIN_COLLECTION)
      .where({ openid: target })
      .limit(1)
      .get();
    if (existing.data.length > 0) {
      return { success: true, data: { _id: existing.data[0]._id, existed: true } };
    }
  } catch (err) {
    if (!isCollectionNotExistError(err)) throw err;
    // 集合不存在则继续创建
  }

  const payload = {
    openid: target,
    name,
    createTime: db.serverDate(),
    createdBy: openid,
  };

  let res;
  try {
    res = await db.collection(ADMIN_COLLECTION).add({ data: payload });
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      await ensureCollection(ADMIN_COLLECTION);
      res = await db.collection(ADMIN_COLLECTION).add({ data: payload });
    } else {
      throw err;
    }
  }
  return { success: true, data: { _id: res._id } };
}

async function removeAdmin(event, openid) {
  const admin = await isAdmin(openid);
  if (!admin) return { success: false, message: '无权限' };

  const target = (event.openid || '').trim();
  if (!target) return { success: false, message: '缺少 openid' };
  if (target === openid) {
    return { success: false, message: '不能移除自己的管理员身份' };
  }

  try {
    const res = await db
      .collection(ADMIN_COLLECTION)
      .where({ openid: target })
      .remove();
    return { success: true, data: res.stats };
  } catch (err) {
    if (isCollectionNotExistError(err)) {
      return { success: true, data: { removed: 0 } };
    }
    throw err;
  }
}

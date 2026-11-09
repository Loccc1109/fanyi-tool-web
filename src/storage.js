let connection;
export function openDB() {
  if (!connection) connection = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(Error('浏览器不支持 IndexedDB，请使用 Chrome/Edge 并退出隐私模式')); return; }
    const request = indexedDB.open('localizer-v2-web', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('jobs', { keyPath: 'job_id' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = null; }; resolve(request.result); };
    request.onerror = () => { connection = null; reject(request.error); };
    request.onblocked = () => reject(Error('数据库被其他标签页占用，请关闭旧页面后重试'));
  });
  return connection;
}
export async function dbOperation(mode, action) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('jobs', mode);
    const request = action(transaction.objectStore('jobs'));
    let result;
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = transaction.onerror = () => reject(transaction.error || Error('本地历史保存失败，可能空间不足；请导出并清理历史'));
  });
}
export const getJob = id => dbOperation('readonly', store => store.get(id));
export const listJobs = () => dbOperation('readonly', store => store.getAll());
export const putJob = job => dbOperation('readwrite', store => store.put(job));
export const deleteJob = id => dbOperation('readwrite', store => store.delete(id));

export async function withJobLock(id, callback) {
  if (!navigator.locks) throw Error('此浏览器缺少 Web Locks，请使用新版 Chrome/Edge（HTTPS 或 localhost）');
  return navigator.locks.request(`localizer-web:${id}`, { ifAvailable: true }, lock => {
    if (!lock) throw Error('此任务正在另一个标签页处理或编辑，请稍后重试');
    return callback();
  });
}

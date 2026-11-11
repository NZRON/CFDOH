const DOH_CONFIG = window.DOH_CONFIG || { path: "dns-query", upstream: "one.one.one.one" };

const currentHost     = window.location.host;
const currentProtocol = window.location.protocol;
const currentDohPath  = DOH_CONFIG.path;
const currentDohUrl   = currentProtocol + '//' + currentHost + '/' + currentDohPath;

const 阻断IPv4 = [
  '104.21.16.1', '104.21.32.1', '104.21.48.1', '104.21.64.1',
  '104.21.80.1', '104.21.96.1', '104.21.112.1'
];
const 阻断IPv6 = [
  '2606:4700:3030::6815:1001',
  '2606:4700:3030::6815:3001',
  '2606:4700:3030::6815:7001',
  '2606:4700:3030::6815:5001'
];

function isBlockedIP(ip) {
  return 阻断IPv4.includes(ip) || 阻断IPv6.includes(ip);
}

const GEO_CACHE_TTL = 60 * 60 * 1000;
const GEO_REQUEST_TIMEOUT = 4000;
const GEO_CACHE_STORAGE_KEY = 'geo_cache_v1';

const geoCache = new Map();
const geoInflight = new Map();

(function restoreGeoCache() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    const now = Date.now();
    for (const [ip, item] of Object.entries(obj)) {
      if (item && item.expireAt > now) geoCache.set(ip, item);
    }
  } catch { }
})();

let geoPersistTimer = null;
function scheduleGeoPersist() {
  if (geoPersistTimer) return;
  geoPersistTimer = setTimeout(() => {
    geoPersistTimer = null;
    try {
      const obj = {};
      const now = Date.now();
      let n = 0;
      for (const [ip, item] of geoCache.entries()) {
        if (item.expireAt > now) {
          obj[ip] = item;
          if (++n >= 200) break;
        }
      }
      localStorage.setItem(GEO_CACHE_STORAGE_KEY, JSON.stringify(obj));
    } catch { }
  }, 1000);
}

function getCachedGeo(ip) {
  const item = geoCache.get(ip);
  if (!item) return null;
  if (Date.now() > item.expireAt) { geoCache.delete(ip); return null; }
  return item.data;
}

function setCachedGeo(ip, data) {
  geoCache.set(ip, { data, expireAt: Date.now() + GEO_CACHE_TTL });
  scheduleGeoPersist();
}

async function fetchGeoFromServer(ip) {
  const url = new URL('/ip-info', window.location.origin);
  url.searchParams.set('ip', ip);
  url.searchParams.set('token', currentDohPath);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEO_REQUEST_TIMEOUT);
  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) throw new Error('Non-JSON response');
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function queryIpGeoInfo(ip) {
  const cached = getCachedGeo(ip);
  if (cached) return cached;
  if (geoInflight.has(ip)) return geoInflight.get(ip);

  const promise = fetchGeoFromServer(ip)
    .then(data => {
      setCachedGeo(ip, data);
      return data;
    })
    .finally(() => {
      geoInflight.delete(ip);
    });

  geoInflight.set(ip, promise);
  return promise;
}

function initTheme() {
  const theme = localStorage.getItem('theme') || 'light';
  const themeToggle = document.getElementById('themeToggle');
  if (theme === 'dark') {
    document.body.classList.add('dark-mode');
    themeToggle.textContent = '☀️';
  } else {
    document.body.classList.remove('dark-mode');
    themeToggle.textContent = '✨';
  }
}

function toggleTheme() {
  if (document.body.classList.contains('dark-mode')) {
    document.body.classList.remove('dark-mode');
    localStorage.setItem('theme', 'light');
    document.getElementById('themeToggle').textContent = '✨';
  } else {
    document.body.classList.add('dark-mode');
    localStorage.setItem('theme', 'dark');
    document.getElementById('themeToggle').textContent = '☀️';
  }
}

document.getElementById('dohSelect').addEventListener('change', function () {
  const customContainer = document.getElementById('customDohContainer');
  customContainer.style.display = (this.value === 'custom') ? 'block' : 'none';
});

document.getElementById('clearBtn').addEventListener('click', function () {
  document.getElementById('domain').value = '';
  document.getElementById('domain').focus();
});

document.getElementById('copyBtn').addEventListener('click', function () {
  const resultText = document.getElementById('result').textContent;
  navigator.clipboard.writeText(resultText).then(function () {
    const originalText = this.textContent;
    this.textContent = '已复制';
    setTimeout(() => { this.textContent = originalText; }, 2000);
  }.bind(this)).catch(function (err) {
    console.error('无法复制文本: ', err);
  });
});

function formatTTL(seconds) {
  seconds = Number(seconds);
  if (isNaN(seconds)) return '未知';
  if (seconds < 60) return seconds + '秒';
  if (seconds < 3600) return Math.floor(seconds / 60) + '分钟';
  if (seconds < 86400) return Math.floor(seconds / 3600) + '小时';
  if (seconds < 2592000) return Math.floor(seconds / 86400) + '天';
  if (seconds < 31536000) return Math.floor(seconds / 2592000) + '个月';
  return Math.floor(seconds / 31536000) + '年';
}

function handleCopyClick(element, textToCopy) {
  navigator.clipboard.writeText(textToCopy).then(function () {
    element.classList.add('copied');
    setTimeout(() => { element.classList.remove('copied'); }, 2000);
  }).catch(function (err) {
    console.error('复制失败:', err);
  });
}

function getRecordClass(recordType) {
  switch (recordType) {
    case 1: return 'record-a';
    case 28: return 'record-aaaa';
    case 5: return 'record-cname';
    case 2: return 'record-ns';
    case 6: return 'record-soa';
    default: return 'record-other';
  }
}
function getRecordTypeName(recordType) {
  switch (recordType) {
    case 1: return 'A';
    case 28: return 'AAAA';
    case 5: return 'CNAME';
    case 2: return 'NS';
    case 6: return 'SOA';
    default: return '类型 ' + recordType;
  }
}
function getRecordTypeClass(recordType) {
  switch (recordType) {
    case 1: return 'type-a';
    case 28: return 'type-aaaa';
    case 5: return 'type-cname';
    case 2: return 'type-ns';
    case 6: return 'type-soa';
    default: return 'type-other';
  }
}

function attachGeoInfo(geoInfoSpan, ip, signal) {
  const skip = () => (signal && signal.aborted) || !geoInfoSpan.isConnected;

  if (isBlockedIP(ip)) {
    geoInfoSpan.innerHTML = '';
    geoInfoSpan.classList.remove('geo-loading');
    const blockedSpan = document.createElement('span');
    blockedSpan.className = 'geo-blocked';
    blockedSpan.textContent = '阻断IP';
    geoInfoSpan.appendChild(blockedSpan);

    queryIpGeoInfo(ip).then(geoData => {
      if (skip()) return;
      if (geoData && geoData.status === 'success' && geoData.as) {
        const asSpan = document.createElement('span');
        asSpan.className = 'geo-as';
        asSpan.textContent = geoData.as;
        geoInfoSpan.appendChild(document.createTextNode(' '));
        geoInfoSpan.appendChild(asSpan);
      }
    }).catch(() => { });
    return;
  }

  queryIpGeoInfo(ip).then(geoData => {
    if (skip()) return;
    if (geoData && geoData.status === 'success') {
      geoInfoSpan.innerHTML = '';
      geoInfoSpan.classList.remove('geo-loading');
      const countrySpan = document.createElement('span');
      countrySpan.className = 'geo-country';
      countrySpan.textContent = geoData.country || '未知国家';
      geoInfoSpan.appendChild(countrySpan);
      if (geoData.as) {
        const asSpan = document.createElement('span');
        asSpan.className = 'geo-as';
        asSpan.textContent = geoData.as;
        geoInfoSpan.appendChild(document.createTextNode(' '));
        geoInfoSpan.appendChild(asSpan);
      }
    } else {
      geoInfoSpan.textContent = '位置获取失败';
      geoInfoSpan.classList.remove('geo-loading');
    }
  }).catch(err => {
    if (skip()) return;
    if (err && err.name === 'AbortError') {
      geoInfoSpan.textContent = '超时';
      geoInfoSpan.classList.remove('geo-loading');
      return;
    }
    geoInfoSpan.textContent = '位置获取失败';
    geoInfoSpan.classList.remove('geo-loading');
  });
}

let currentGeoAbortController = null;

function displayRecords(data) {
  if (currentGeoAbortController) currentGeoAbortController.abort();
  currentGeoAbortController = new AbortController();
  const geoSignal = currentGeoAbortController.signal;

  document.getElementById('resultContainer').style.display = 'block';
  document.getElementById('errorContainer').style.display = 'none';
  document.getElementById('result').textContent = JSON.stringify(data, null, 2);

  const ipv4Records = data.ipv4?.records || [];
  const ipv4Container = document.getElementById('ipv4Records');
  ipv4Container.innerHTML = '';

  if (ipv4Records.length === 0) {
    document.getElementById('ipv4Summary').innerHTML = `<strong>未找到 IPv4 记录</strong>`;
  } else {
    document.getElementById('ipv4Summary').innerHTML = `<strong>找到 ${ipv4Records.length} 条 IPv4 记录</strong>`;

    ipv4Records.forEach(record => {
      const recordClass = getRecordClass(record.type);
      const typeClass = getRecordTypeClass(record.type);
      const recordDiv = document.createElement('div');
      recordDiv.className = `ip-record ${recordClass}`;

      if (record.type === 5) {
        recordDiv.innerHTML = `
          <div class="ip-record-row">
            <div class="ip-record-cell">域名</div>
            <div class="ip-record-cell"><span class="ip-address" data-copy="${record.data}">${record.data}</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">类型</div>
            <div class="ip-record-cell"><span class="record-type ${typeClass}">${getRecordTypeName(record.type)}</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">TTL</div>
            <div class="ip-record-cell"><span class="ttl-info">${formatTTL(record.TTL)}</span></div>
          </div>`;
        ipv4Container.appendChild(recordDiv);
        recordDiv.querySelector('.ip-address').addEventListener('click', function () {
          handleCopyClick(this, this.getAttribute('data-copy'));
        });
      } else if (record.type === 1) {
        recordDiv.innerHTML = `
          <div class="ip-record-row">
            <div class="ip-record-cell">IP地址</div>
            <div class="ip-record-cell"><span class="ip-address" data-copy="${record.data}">${record.data}</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">地理位置</div>
            <div class="ip-record-cell"><span class="geo-loading">正在获取位置信息...</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">类型</div>
            <div class="ip-record-cell"><span class="record-type ${typeClass}">${getRecordTypeName(record.type)}</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">TTL</div>
            <div class="ip-record-cell"><span class="ttl-info">${formatTTL(record.TTL)}</span></div>
          </div>`;
        ipv4Container.appendChild(recordDiv);
        recordDiv.querySelector('.ip-address').addEventListener('click', function () {
          handleCopyClick(this, this.getAttribute('data-copy'));
        });
        attachGeoInfo(recordDiv.querySelector('.geo-loading'), record.data, geoSignal);
      }
    });
  }

  const ipv6Records = data.ipv6?.records || [];
  const ipv6Container = document.getElementById('ipv6Records');
  ipv6Container.innerHTML = '';

  if (ipv6Records.length === 0) {
    document.getElementById('ipv6Summary').innerHTML = `<strong>未找到 IPv6 记录</strong>`;
  } else {
    document.getElementById('ipv6Summary').innerHTML = `<strong>找到 ${ipv6Records.length} 条 IPv6 记录</strong>`;

    ipv6Records.forEach(record => {
      const recordClass = getRecordClass(record.type);
      const typeClass = getRecordTypeClass(record.type);
      const recordDiv = document.createElement('div');
      recordDiv.className = `ip-record ${recordClass}`;

      if (record.type === 5) {
        recordDiv.innerHTML = `
          <div class="ip-record-row">
            <div class="ip-record-cell">域名</div>
            <div class="ip-record-cell"><span class="ip-address" data-copy="${record.data}">${record.data}</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">类型</div>
            <div class="ip-record-cell"><span class="record-type ${typeClass}">${getRecordTypeName(record.type)}</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">TTL</div>
            <div class="ip-record-cell"><span class="ttl-info">${formatTTL(record.TTL)}</span></div>
          </div>`;
        ipv6Container.appendChild(recordDiv);
        recordDiv.querySelector('.ip-address').addEventListener('click', function () {
          handleCopyClick(this, this.getAttribute('data-copy'));
        });
      } else if (record.type === 28) {
        recordDiv.innerHTML = `
          <div class="ip-record-row">
            <div class="ip-record-cell">IP地址</div>
            <div class="ip-record-cell"><span class="ip-address" data-copy="${record.data}">${record.data}</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">地理位置</div>
            <div class="ip-record-cell"><span class="geo-loading">正在获取位置信息...</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">类型</div>
            <div class="ip-record-cell"><span class="record-type ${typeClass}">${getRecordTypeName(record.type)}</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">TTL</div>
            <div class="ip-record-cell"><span class="ttl-info">${formatTTL(record.TTL)}</span></div>
          </div>`;
        ipv6Container.appendChild(recordDiv);
        recordDiv.querySelector('.ip-address').addEventListener('click', function () {
          handleCopyClick(this, this.getAttribute('data-copy'));
        });
        attachGeoInfo(recordDiv.querySelector('.geo-loading'), record.data, geoSignal);
      }
    });
  }

  const nsRecords = data.ns?.records || [];
  const nsContainer = document.getElementById('nsRecords');
  nsContainer.innerHTML = '';

  if (nsRecords.length === 0) {
    document.getElementById('nsSummary').innerHTML = `<strong>未找到 NS 记录</strong>`;
  } else {
    document.getElementById('nsSummary').innerHTML = `<strong>找到 ${nsRecords.length} 条名称服务器记录</strong>`;

    nsRecords.forEach(record => {
      const recordClass = getRecordClass(record.type);
      const typeClass = getRecordTypeClass(record.type);
      const recordDiv = document.createElement('div');
      recordDiv.className = `ip-record ${recordClass}`;

      if (record.type === 2) {
        recordDiv.innerHTML = `
          <div class="ip-record-row">
            <div class="ip-record-cell">名称服务器</div>
            <div class="ip-record-cell"><span class="ip-address" data-copy="${record.data}">${record.data}</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">类型</div>
            <div class="ip-record-cell"><span class="record-type ${typeClass}">${getRecordTypeName(record.type)}</span></div>
          </div>
          <div class="ip-record-row">
            <div class="ip-record-cell">TTL</div>
            <div class="ip-record-cell"><span class="ttl-info">${formatTTL(record.TTL)}</span></div>
          </div>`;
        recordDiv.querySelector('.ip-address').addEventListener('click', function () {
          handleCopyClick(this, this.getAttribute('data-copy'));
        });
      } else if (record.type === 6) {
        const soaParts = record.data.split(' ');
        let adminEmail = soaParts[1].replace('.', '@');
        if (adminEmail.endsWith('.')) adminEmail = adminEmail.slice(0, -1);
        recordDiv.innerHTML = `
          <div class="ip-record-row"><div class="ip-record-cell">域名</div>
            <div class="ip-record-cell"><span class="ip-address" data-copy="${record.name}">${record.name}</span></div></div>
          <div class="ip-record-row"><div class="ip-record-cell">类型</div>
            <div class="ip-record-cell"><span class="record-type ${typeClass}">${getRecordTypeName(record.type)}</span></div></div>
          <div class="ip-record-row"><div class="ip-record-cell">主 NS</div>
            <div class="ip-record-cell"><span class="ip-address" data-copy="${soaParts[0]}">${soaParts[0]}</span></div></div>
          <div class="ip-record-row"><div class="ip-record-cell">管理邮箱</div>
            <div class="ip-record-cell"><span class="ip-address" data-copy="${adminEmail}">${adminEmail}</span></div></div>
          <div class="ip-record-row"><div class="ip-record-cell">序列号</div>
            <div class="ip-record-cell"><span>${soaParts[2]}</span></div></div>
          <div class="ip-record-row"><div class="ip-record-cell">刷新间隔</div>
            <div class="ip-record-cell"><span>${formatTTL(soaParts[3])}</span></div></div>
          <div class="ip-record-row"><div class="ip-record-cell">重试间隔</div>
            <div class="ip-record-cell"><span>${formatTTL(soaParts[4])}</span></div></div>
          <div class="ip-record-row"><div class="ip-record-cell">过期时间</div>
            <div class="ip-record-cell"><span>${formatTTL(soaParts[5])}</span></div></div>
          <div class="ip-record-row"><div class="ip-record-cell">最小 TTL</div>
            <div class="ip-record-cell"><span>${formatTTL(soaParts[6])}</span></div></div>`;
        recordDiv.querySelectorAll('.ip-address').forEach(elem => {
          elem.addEventListener('click', function () {
            handleCopyClick(this, this.getAttribute('data-copy'));
          });
        });
      } else {
        recordDiv.innerHTML = `
          <div class="ip-record-row"><div class="ip-record-cell">数据</div>
            <div class="ip-record-cell"><span class="ip-address" data-copy="${record.data}">${record.data}</span></div></div>
          <div class="ip-record-row"><div class="ip-record-cell">类型</div>
            <div class="ip-record-cell"><span class="record-type ${typeClass}">${getRecordTypeName(record.type)}</span></div></div>
          <div class="ip-record-row"><div class="ip-record-cell">TTL</div>
            <div class="ip-record-cell"><span class="ttl-info">${formatTTL(record.TTL)}</span></div></div>`;
        recordDiv.querySelector('.ip-address').addEventListener('click', function () {
          handleCopyClick(this, this.getAttribute('data-copy'));
        });
      }
      nsContainer.appendChild(recordDiv);
    });
  }

  document.getElementById('copyBtn').style.display = 'block';
}

function displayError(message) {
  if (currentGeoAbortController) currentGeoAbortController.abort();
  document.getElementById('resultContainer').style.display = 'none';
  document.getElementById('errorContainer').style.display = 'block';
  document.getElementById('errorMessage').textContent = message;
  document.getElementById('copyBtn').style.display = 'none';
}

let currentQueryController = null;

document.getElementById('resolveForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const dohSelect = document.getElementById('dohSelect').value;
  let doh;
  if (dohSelect === 'current') doh = currentDohUrl;
  else if (dohSelect === 'custom') {
    doh = (document.getElementById('customDoh').value || '').trim();
    if (!doh) { alert('请输入自定义 DoH 地址'); return; }
  } else doh = dohSelect;

  const domain = (document.getElementById('domain').value || '').trim();
  if (!domain) { alert('请输入需要解析的域名'); return; }

  if (currentQueryController) currentQueryController.abort();
  currentQueryController = new AbortController();
  const querySignal = currentQueryController.signal;

  document.getElementById('loading').style.display = 'block';
  document.getElementById('resultContainer').style.display = 'none';
  document.getElementById('errorContainer').style.display = 'none';
  document.getElementById('copyBtn').style.display = 'none';

  try {
    const reqUrl = new URL(window.location.href);
    reqUrl.hash = '';
    reqUrl.search = '';
    reqUrl.searchParams.set('doh', doh);
    reqUrl.searchParams.set('domain', domain);
    reqUrl.searchParams.set('type', 'all');

    const response = await fetch(reqUrl.toString(), {
      headers: { Accept: 'application/json' },
      signal: querySignal,
    });

    if (!response.ok) throw new Error(`HTTP 错误: ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      const text = await response.text();
      throw new Error(
        `后端未返回 JSON（content-type: ${contentType || '空'}）。` +
        `请检查 functions/_middleware.js 是否已生效，` +
        `响应开头: ${text.substring(0, 120)}`
      );
    }

    const json = await response.json();
    if (querySignal.aborted) return;
    if (json.error) displayError(json.error);
    else displayRecords(json);
  } catch (error) {
    if (error.name === 'AbortError') return;
    displayError('查询失败: ' + error.message);
  } finally {
    if (!querySignal.aborted) {
      document.getElementById('loading').style.display = 'none';
    }
  }
});

document.addEventListener('DOMContentLoaded', function () {
  initTheme();
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  const lastDomain = localStorage.getItem('lastDomain');
  if (lastDomain) document.getElementById('domain').value = lastDomain;
  document.getElementById('domain').addEventListener('input', function () {
    localStorage.setItem('lastDomain', this.value);
  });

  document.getElementById('currentDomain').textContent = currentHost;
  document.getElementById('currentDohPath').textContent = currentDohPath;
  document.getElementById('dohUpstream').textContent = DOH_CONFIG.upstream;

  const currentDohOption = document.getElementById('currentDohOption');
  if (currentDohOption) currentDohOption.textContent = currentDohUrl + '';  // 当前站点

  const dohUrlDisplay = document.getElementById('dohUrlDisplay');
  if (dohUrlDisplay) {
    dohUrlDisplay.addEventListener('click', function () {
      const textToCopy = currentProtocol + '//' + currentHost + '/' + currentDohPath;
      navigator.clipboard.writeText(textToCopy).then(function () {
        dohUrlDisplay.classList.add('copied');
        setTimeout(() => dohUrlDisplay.classList.remove('copied'), 2000);
      }).catch(function (err) { console.error('复制失败:', err); });
    });
  }

  document.getElementById('getJsonBtn').addEventListener('click', function () {
    const dohSelect = document.getElementById('dohSelect').value;
    let dohUrl;
    if (dohSelect === 'current') {
      dohUrl = currentDohUrl;
    } else if (dohSelect === 'custom') {
      dohUrl = (document.getElementById('customDoh').value || '').trim();
      if (!dohUrl) { alert('请输入自定义 DoH 地址'); return; }
    } else {
      dohUrl = dohSelect;
    }

    const domain = (document.getElementById('domain').value || '').trim();
    if (!domain) { alert('请输入需要解析的域名'); return; }

    let jsonUrl;
    try {
      jsonUrl = new URL(dohUrl);
    } catch {
      alert('DoH 地址格式不正确: ' + dohUrl);
      return;
    }
    jsonUrl.searchParams.set('name', domain);

    const win = window.open(jsonUrl.toString(), '_blank', 'noopener');
    if (!win) {
      if (confirm('弹窗被浏览器拦截，是否在当前页打开 JSON？')) {
        window.location.href = jsonUrl.toString();
      }
    }
  });
});

// 天气查询 — 使用 wttr.in（免费，无需 API key）
// 内存缓存30分钟，避免每条消息都请求

const CACHE_TTL = 30 * 60 * 1000; // 30分钟
const cache = new Map(); // city -> { text, ts }

const CONDITION_MAP = {
  'Sunny': '晴', 'Clear': '晴', 'Partly cloudy': '多云', 'Cloudy': '阴',
  'Overcast': '阴', 'Mist': '薄雾', 'Fog': '雾', 'Freezing fog': '冻雾',
  'Light rain': '小雨', 'Moderate rain': '中雨', 'Heavy rain': '大雨',
  'Light drizzle': '小雨', 'Freezing drizzle': '冻雨', 'Heavy drizzle': '大雨',
  'Light snow': '小雪', 'Moderate snow': '中雪', 'Heavy snow': '大雪',
  'Blizzard': '暴雪', 'Thundery outbreaks possible': '雷阵雨',
  'Patchy rain possible': '局部小雨', 'Light sleet': '雨夹雪',
  'Moderate or heavy sleet': '中雨夹雪', 'Light rain shower': '阵雨',
  'Moderate or heavy rain shower': '大阵雨', 'Torrential rain shower': '暴雨',
  'Light snow showers': '阵雪', 'Moderate or heavy snow showers': '大阵雪',
  'Light showers of ice pellets': '小冰雹', 'Moderate or heavy showers of ice pellets': '大冰雹',
  'Patchy light rain with thunder': '雷阵雨', 'Moderate or heavy rain with thunder': '强雷阵雨',
  'Smoke': '烟雾', 'Smoky haze': '霾', 'Haze': '霾', 'Dust': '浮尘', 'Sand': '沙尘',
};

function translateCondition(desc) {
  return CONDITION_MAP[desc] || desc;
}

function dayLabel(offsetDays) {
  if (offsetDays === 0) return '今天';
  if (offsetDays === 1) return '明天';
  if (offsetDays === 2) return '后天';
  return `${offsetDays}天后`;
}

/**
 * 获取城市天气（今天+明天），返回注入用的简短文本
 * @param {string} city
 * @returns {Promise<string|null>}
 */
export async function getCityWeatherText(city) {
  if (!city || !city.trim()) return null;
  const key = city.trim().toLowerCase();

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.text;

  try {
    const url = `https://wttr.in/${encodeURIComponent(city.trim())}?format=j1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();

    const current = data.current_condition?.[0];
    const weathers = data.weather || [];
    if (!current || !weathers.length) return null;

    const curDesc = translateCondition(current.weatherDesc?.[0]?.value || '');
    const curTemp = current.temp_C || '?';
    const curFeel = current.FeelsLikeC || curTemp;

    const days = weathers.slice(0, 2).map((w, i) => {
      const desc = translateCondition(w.hourly?.[4]?.weatherDesc?.[0]?.value || w.weatherDesc?.[0]?.value || '');
      const maxT = w.maxtempC || '?';
      const minT = w.mintempC || '?';
      // 降水判断：hourly 里有没有 precipMM > 0
      const hasRain = (w.hourly || []).some(h => parseFloat(h.precipMM || 0) > 0.3);
      const rainHint = hasRain ? '，有降水' : '';
      return `${dayLabel(i)}${desc} ${minT}~${maxT}°C${rainHint}`;
    });

    const text = `【${city}天气】当前：${curDesc} ${curTemp}°C（体感${curFeel}°C）；${days.join('；')}`;
    cache.set(key, { text, ts: Date.now() });
    return text;
  } catch {
    return null;
  }
}

export function getCachedCityWeatherText(city) {
  const key = String(city || '').trim().toLowerCase();
  const cached = key ? cache.get(key) : null;
  return cached && Date.now() - cached.ts < CACHE_TTL ? cached.text : null;
}

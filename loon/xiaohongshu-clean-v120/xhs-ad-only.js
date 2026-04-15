"use strict";

/*
 * 小红书去广告脚本
 * 1. 处理开屏、信息流、搜索推荐、推荐位等广告字段
 * 2. 保守保留正常结构，避免因为删字段过猛导致页面异常
 */

const requestObject = typeof $request !== "undefined" ? $request : null;
const responseObject = typeof $response !== "undefined" ? $response : null;
const url = requestObject && requestObject.url ? requestObject.url : "";

const FEED_KEYS = new Set([
  "data",
  "datas",
  "items",
  "item",
  "feed",
  "feeds",
  "note_list",
  "notes",
  "cards",
  "homefeed",
  "homefeed_items",
  "recommend_items",
  "note_items",
  "search_result",
  "search_results",
  "channel_items",
  "list",
  "sections",
  "queries",
  "queries_list",
  "hint_words",
  "hot_list",
  "widget_list",
  "tabs"
]);

const AD_CONTAINER_KEYS = new Set([
  "ad_info",
  "ads_info",
  "ad_infos",
  "ad_list",
  "ads",
  "ads_groups",
  "ads_group",
  "banner",
  "banners",
  "banner_list",
  "insert_ad",
  "insert_ads",
  "insert_card",
  "insert_cards",
  "launch_ad",
  "launch_ads",
  "splash_ad",
  "splash_ads",
  "startup_ad",
  "startup_ads",
  "ad_cards",
  "ad_slot",
  "ad_slots",
  "advertisement",
  "advertisements",
  "promotion_info",
  "promotion_card",
  "promotion_cards",
  "commercial_info",
  "sponsor_info",
  "recommend_info",
  "recommend_infos",
  "top_banner",
  "bottom_banner"
]);

const AD_FLAG_KEYS = new Set([
  "is_ad",
  "is_ads",
  "has_ads",
  "has_ad",
  "show_ad",
  "need_ad",
  "need_ads",
  "ad",
  "ads",
  "promoted",
  "promotion",
  "is_sponsored",
  "is_banner",
  "is_promoted",
  "is_commercial"
]);

const NOTE_HINT_KEYS = new Set([
  "note",
  "note_card",
  "note_info",
  "note_item",
  "note_data",
  "note_id",
  "note_list",
  "xsec_token",
  "display_title",
  "interact_info",
  "cover",
  "cover_info",
  "image_list",
  "user",
  "user_info",
  "recommend_reason",
  "track_id",
  "model_type",
  "card_type"
]);

const SPLASH_HINT_RE = /(splash|startup|launch|init|boot|open_screen)/i;
const AD_TYPE_RE = /(ad|ads|advert|banner|insert|sponsor|promotion|commercial)/i;
const AD_KEY_RE = /(ad|ads|advert|banner|insert|sponsor|promotion|commercial|splash|startup)/i;

try {
  if (!responseObject || !responseObject.body) {
    $done({});
    return;
  }

  const body = JSON.parse(responseObject.body);
  const cleaned = sanitizeValue(body, []);

  if (SPLASH_HINT_RE.test(url)) {
    neutralizeSplash(cleaned);
  }

  $done({ body: JSON.stringify(cleaned) });
} catch (error) {
  console.log("xhs-ad-only-v120 parse failed: " + error.message);
  $done({ body: responseObject && responseObject.body ? responseObject.body : "" });
}

function sanitizeValue(value, path) {
  if (Array.isArray(value)) {
    return sanitizeArray(value, path);
  }

  if (isObject(value)) {
    return sanitizeObject(value, path);
  }

  return value;
}

function sanitizeArray(list, path) {
  const key = path.length ? String(path[path.length - 1]).toLowerCase() : "";
  const treatAsFeed = FEED_KEYS.has(key) || looksLikeFeedArray(list);
  const result = [];

  for (const item of list) {
    const next = sanitizeValue(item, path.concat(result.length));

    if (treatAsFeed && isObject(next) && isAdItem(next)) {
      continue;
    }

    result.push(next);
  }

  return result;
}

function sanitizeObject(obj, path) {
  for (const key of Object.keys(obj)) {
    const normalizedKey = key.toLowerCase();
    const value = obj[key];

    if (AD_CONTAINER_KEYS.has(normalizedKey) || shouldEmptyByKey(normalizedKey, value)) {
      obj[key] = emptyLike(value);
      continue;
    }

    if (AD_FLAG_KEYS.has(normalizedKey)) {
      obj[key] = value === true ? false : emptyLike(value);
      continue;
    }

    if (Array.isArray(value)) {
      obj[key] = sanitizeArray(value, path.concat(key));
      continue;
    }

    if (isObject(value)) {
      if (isAdOnlyBranch(normalizedKey, value)) {
        obj[key] = emptyLike(value);
        continue;
      }

      obj[key] = sanitizeObject(value, path.concat(key));
      continue;
    }

    if (SPLASH_HINT_RE.test(normalizedKey) && SPLASH_HINT_RE.test(url)) {
      obj[key] = emptyLike(value);
    }
  }

  return obj;
}

function looksLikeFeedArray(list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.some((item) => isObject(item) && (looksLikeFeedItem(item) || isAdItem(item)));
}

function looksLikeFeedItem(item) {
  if (!isObject(item)) return false;
  return Object.keys(item).some((key) => NOTE_HINT_KEYS.has(String(key).toLowerCase()));
}

function isAdItem(item) {
  const candidates = gatherCandidates(item);

  return candidates.some((candidate) => {
    if (!isObject(candidate)) return false;

    if (
      candidate.is_ads === true ||
      candidate.is_ad === true ||
      candidate.promoted === true ||
      candidate.is_sponsored === true ||
      candidate.is_promoted === true
    ) {
      return true;
    }

    if (
      candidate.ads_info ||
      candidate.ad_info ||
      candidate.ad_track ||
      candidate.commercial_info ||
      candidate.promotion_info ||
      candidate.recommend_info
    ) {
      return true;
    }

    const typeValues = [
      candidate.type,
      candidate.card_type,
      candidate.model_type,
      candidate.display_type,
      candidate.item_type,
      candidate.note_type
    ];

    return typeValues.some((value) => typeof value === "string" && AD_TYPE_RE.test(value));
  });
}

function shouldEmptyByKey(key, value) {
  if (!AD_KEY_RE.test(key)) {
    return false;
  }

  if (looksLikeFeedItem(value)) {
    return false;
  }

  if (Array.isArray(value)) {
    return !looksLikeFeedArray(value);
  }

  return true;
}

function isAdOnlyBranch(key, value) {
  if (AD_CONTAINER_KEYS.has(key) || shouldEmptyByKey(key, value)) {
    return true;
  }

  if (!isObject(value)) {
    return false;
  }

  if (SPLASH_HINT_RE.test(key) && SPLASH_HINT_RE.test(url)) {
    return true;
  }

  return isAdItem(value) && !looksLikeFeedItem(value);
}

function gatherCandidates(item) {
  const candidates = [item];

  if (!isObject(item)) {
    return candidates;
  }

  const nestedKeys = [
    "note",
    "note_card",
    "note_info",
    "note_item",
    "note_data",
    "item",
    "data",
    "target",
    "model",
    "card",
    "common",
    "content",
    "post",
    "media",
    "widget"
  ];

  for (const key of nestedKeys) {
    if (isObject(item[key])) {
      candidates.push(item[key]);
    }
  }

  return candidates;
}

function neutralizeSplash(root) {
  if (!isObject(root)) return;

  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const key of Object.keys(current)) {
      const normalizedKey = key.toLowerCase();
      const value = current[key];

      if (AD_CONTAINER_KEYS.has(normalizedKey) || SPLASH_HINT_RE.test(normalizedKey) || shouldEmptyByKey(normalizedKey, value)) {
        current[key] = emptyLike(value);
        continue;
      }

      if (Array.isArray(value)) {
        current[key] = value.filter((item) => !isAdItem(item)).map((item, index) => sanitizeValue(item, [key, index]));
        continue;
      }

      if (isObject(value)) {
        queue.push(value);
      }
    }
  }
}

function emptyLike(value) {
  if (Array.isArray(value)) return [];
  if (typeof value === "boolean") return false;
  if (typeof value === "number") return 0;
  if (typeof value === "string") return "";
  if (isObject(value)) return {};
  return null;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

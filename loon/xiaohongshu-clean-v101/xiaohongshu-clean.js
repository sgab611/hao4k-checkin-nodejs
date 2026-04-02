"use strict";

/*
 * 小红书去广告 + 视频贴文开关
 * 1. 通过响应体清理开屏广告、信息流广告、推荐位广告
 * 2. show_video=false 时过滤信息流中的视频贴文
 * 3. 保守处理字段，尽量保留原始结构，降低崩溃风险
 */

const requestObject = typeof $request !== "undefined" ? $request : null;
const responseObject = typeof $response !== "undefined" ? $response : null;
const argumentObject = typeof $argument !== "undefined" ? $argument : null;

const url = requestObject && requestObject.url ? requestObject.url : "";
const args = parseArgument(argumentObject);
const showVideo = toBoolean(args.show_video, true);

const FEED_KEYS = new Set([
  "data",
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
  "note_items"
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
  "commercial_info",
  "sponsor_info",
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
  "is_banner"
]);

const SPLASH_HINT_RE = /(splash|startup|launch|init|boot|open_screen)/i;
const VIDEO_TYPE_RE = /(video|videofeed|video_note|video_post|note_video|media_video)/i;
const AD_TYPE_RE = /(ad|ads|advert|banner|insert|sponsor|promotion|commercial)/i;
const VIDEO_DIRECT_KEYS = new Set([
  "video",
  "videos",
  "video_info",
  "video_info_v2",
  "video_consumer",
  "video_media",
  "video_stream",
  "video_url",
  "video_id",
  "origin_video_key",
  "master_url",
  "stream"
]);
const TYPE_LIKE_KEYS = new Set([
  "note_type",
  "type",
  "card_type",
  "model_type",
  "display_type",
  "media_type",
  "content_type",
  "item_type"
]);

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
  console.log("xiaohongshu-clean parse failed: " + error.message);
  $done({ body: responseObject && responseObject.body ? responseObject.body : "" });
}

function parseArgument(raw) {
  if (!raw) return {};

  if (typeof raw === "object") {
    return raw;
  }

  if (typeof raw !== "string") {
    return {};
  }

  const normalized = raw.trim();
  if (!normalized) return {};

  if (!/[=:]/.test(normalized) && /^(true|false|1|0|on|off|yes|no)$/i.test(normalized)) {
    return { show_video: normalized };
  }

  return normalized.split(/[,&]/).reduce((acc, part) => {
    const pair = part.split(/[=:]/);
    const key = pair[0];
    const value = pair.slice(1).join("=");
    if (!key) return acc;
    acc[key.trim()] = value == null ? "" : value.trim();
    return acc;
  }, {});
}

function toBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(normalized)) return true;
  if (["false", "0", "off", "no"].includes(normalized)) return false;
  return fallback;
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
    if (treatAsFeed && isObject(item) && isAdItem(item)) {
      continue;
    }

    const next = sanitizeValue(item, path.concat(result.length));

    if (!showVideo && isObject(next) && (treatAsFeed || looksLikeFeedItem(next)) && isVideoItem(next)) {
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

    if (AD_CONTAINER_KEYS.has(normalizedKey)) {
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

  const directKeys = [
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
  ];

  return directKeys.some((key) => key in item);
}

function isVideoItem(item) {
  const candidates = gatherCandidates(item);

  return candidates.some((candidate) => {
    if (!isObject(candidate)) return false;

    const typeValues = [
      candidate.note_type,
      candidate.type,
      candidate.card_type,
      candidate.model_type,
      candidate.display_type,
      candidate.media_type,
      candidate.content_type
    ];

    if (typeValues.some((value) => matchesVideoType(value))) {
      return true;
    }

    for (const key of VIDEO_DIRECT_KEYS) {
      if (hasMeaningfulValue(candidate[key])) {
        return true;
      }
    }

    if (Array.isArray(candidate.note_attributes) && candidate.note_attributes.some((value) => matchesVideoType(value))) {
      return true;
    }

    return hasVideoSignalDeep(candidate, 0, new WeakSet());
  });
}

function isAdItem(item) {
  const candidates = gatherCandidates(item);

  return candidates.some((candidate) => {
    if (!isObject(candidate)) return false;

    if (candidate.is_ads === true || candidate.is_ad === true || candidate.promoted === true) {
      return true;
    }

    if (candidate.ads_info || candidate.ad_info || candidate.ad_track || candidate.commercial_info) {
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

    if (typeValues.some((value) => typeof value === "string" && AD_TYPE_RE.test(value))) {
      return true;
    }

    return false;
  });
}

function isAdOnlyBranch(key, value) {
  if (AD_CONTAINER_KEYS.has(key)) {
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
    "media"
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

      if (AD_CONTAINER_KEYS.has(normalizedKey) || SPLASH_HINT_RE.test(normalizedKey)) {
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

function matchesVideoType(value) {
  if (typeof value === "string") {
    return VIDEO_TYPE_RE.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => matchesVideoType(item));
  }

  return false;
}

function hasMeaningfulValue(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function hasVideoSignalDeep(value, depth, seen) {
  if (depth > 6 || value == null) return false;

  if (Array.isArray(value)) {
    return value.some((item) => hasVideoSignalDeep(item, depth + 1, seen));
  }

  if (!isObject(value)) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();

    if (VIDEO_DIRECT_KEYS.has(normalizedKey) && hasMeaningfulValue(child)) {
      return true;
    }

    if (TYPE_LIKE_KEYS.has(normalizedKey) && matchesVideoType(child)) {
      return true;
    }

    if (normalizedKey === "note_attributes" && matchesVideoType(child)) {
      return true;
    }

    if (Array.isArray(child) || isObject(child)) {
      if (hasVideoSignalDeep(child, depth + 1, seen)) {
        return true;
      }
      continue;
    }

    if (typeof child === "string" && TYPE_LIKE_KEYS.has(normalizedKey) && matchesVideoType(child)) {
      return true;
    }
  }

  return false;
}

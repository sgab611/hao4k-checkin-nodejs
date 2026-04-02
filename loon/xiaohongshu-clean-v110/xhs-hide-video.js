"use strict";

/*
 * 小红书隐藏视频脚本
 * 1. 同时保留去广告逻辑，避免开启隐藏视频后失去净化能力
 * 2. 使用更明确的 feed 数组遍历与 video 信号检测，优先处理 note_card.type === \"video\"
 */

const requestObject = typeof $request !== "undefined" ? $request : null;
const responseObject = typeof $response !== "undefined" ? $response : null;
const url = requestObject && requestObject.url ? requestObject.url : "";

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
  "note_items",
  "search_result",
  "search_results",
  "channel_items",
  "list"
]);

const NOTE_HINT_KEYS = new Set([
  "note",
  "note_card",
  "note_info",
  "note_item",
  "note_data",
  "note_id",
  "xsec_token",
  "display_title",
  "interact_info",
  "cover",
  "image_list",
  "user",
  "user_info",
  "track_id",
  "recommend_reason",
  "model_type",
  "card_type"
]);

const TYPE_KEYS = new Set([
  "type",
  "note_type",
  "card_type",
  "model_type",
  "display_type",
  "media_type",
  "content_type",
  "item_type"
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
const VIDEO_VALUE_RE = /(video|videofeed|video_note|video_post|note_video|media_video)/i;
const AD_TYPE_RE = /(ad|ads|advert|banner|insert|sponsor|promotion|commercial)/i;

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
  console.log("xhs-hide-video parse failed: " + error.message);
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

    if (treatAsFeed && isObject(next) && isVideoItem(next)) {
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
  return list.some((item) => isObject(item) && (looksLikeFeedItem(item) || isAdItem(item) || isVideoItem(item)));
}

function looksLikeFeedItem(item) {
  if (!isObject(item)) return false;
  return Object.keys(item).some((key) => NOTE_HINT_KEYS.has(key.toLowerCase()));
}

function isVideoItem(item) {
  const candidates = gatherCandidates(item);

  return candidates.some((candidate) => {
    if (!isObject(candidate)) return false;

    for (const key of TYPE_KEYS) {
      if (matchesVideoValue(candidate[key])) {
        return true;
      }
    }

    if (hasDirectVideoKey(candidate)) {
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

    return typeValues.some((value) => typeof value === "string" && AD_TYPE_RE.test(value));
  });
}

function hasDirectVideoKey(obj) {
  return Object.keys(obj).some((key) => {
    const normalizedKey = key.toLowerCase();
    if (!normalizedKey.includes("video")) {
      return false;
    }

    return hasMeaningfulValue(obj[key]);
  });
}

function matchesVideoValue(value) {
  if (typeof value === "string") {
    return VIDEO_VALUE_RE.test(value);
  }

  if (Array.isArray(value)) {
    return value.some((item) => matchesVideoValue(item));
  }

  return false;
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

    if (normalizedKey.includes("video") && hasMeaningfulValue(child)) {
      return true;
    }

    if (TYPE_KEYS.has(normalizedKey) && matchesVideoValue(child)) {
      return true;
    }

    if (Array.isArray(child) || isObject(child)) {
      if (hasVideoSignalDeep(child, depth + 1, seen)) {
        return true;
      }
    }
  }

  return false;
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

function hasMeaningfulValue(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return true;
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

type Platform = "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "pinterest";

export function formatForPlatform(platform: Platform, caption: string, hashtags: string[]): { caption: string; hashtags: string[] } {
  const normalizedHashtags = hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));

  if (platform === "linkedin") {
    return {
      caption: caption.replace(/\n{3,}/g, "\n\n"),
      hashtags: normalizedHashtags.slice(0, 5),
    };
  }

  if (platform === "x") {
    const shortened = caption.length > 260 ? `${caption.slice(0, 257)}...` : caption;
    return {
      caption: shortened,
      hashtags: normalizedHashtags.slice(0, 4),
    };
  }

  if (platform === "tiktok") {
    return {
      caption,
      hashtags: normalizedHashtags.slice(0, 8),
    };
  }

  return {
    caption,
    hashtags: normalizedHashtags.slice(0, 12),
  };
}

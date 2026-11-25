export const MAX_MOBILE_ATTACHMENTS = 20;
export const MAX_MOBILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_MOBILE_IMAGE_BASE64 =
	Math.ceil(MAX_MOBILE_IMAGE_BYTES / 3) * 4;
// Images are resized before uploading. Bound the whole batch separately so a
// photo library cannot exhaust the desktop process's JSON parser.
export const MAX_MOBILE_PROMPT_BYTES = 32 * 1024 * 1024;

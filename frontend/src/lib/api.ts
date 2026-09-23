import { VibexApiClient } from "@vibexcorp/api-client";

export const api = new VibexApiClient(
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1"
);

// URL absoluta do zip servido pelo backend (GET /api/v1/downloads/extension.zip).
export const EXTENSION_DOWNLOAD_URL = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1"}${VibexApiClient.EXTENSION_DOWNLOAD_URL}`;

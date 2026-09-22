import { VibexApiClient } from "@vibexcorp/api-client";

export const api = new VibexApiClient(
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1"
);

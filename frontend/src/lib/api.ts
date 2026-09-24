import { VibexApiClient } from "@vibexcorp/api-client";

export const api = new VibexApiClient(
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api/v1"
);

// Zip da extensão servido pelo próprio frontend (frontend/public), atualizado
// a cada boot pelo iniciar.bat a partir de ext/vibexcorp-extension.zip.
// O backend também mantém GET /api/v1/downloads/extension.zip como alternativa.
export const EXTENSION_DOWNLOAD_URL = "/vibexcorp-extension.zip";

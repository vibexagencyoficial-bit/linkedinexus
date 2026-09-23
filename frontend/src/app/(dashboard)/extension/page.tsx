import { redirect } from "next/navigation";

// A gestão da extensão mora agora em Configurações (seção "Extensão Chrome").
// Rota antiga mantida apenas para redirecionar links salvos.
export default function ExtensionPage() {
  redirect("/settings#extensao");
}

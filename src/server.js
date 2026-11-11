// Uso: npm start   (PORT=3000, BANCO=dados/links.db; opcionais: BASE_URL, PAINEL_TOKEN)
import { createApp } from "./app.js";
import { semear } from "./semente.js";

const porta = Number(process.env.PORT ?? 3000);
const { servidor, db } = createApp({ banco: process.env.BANCO ?? "dados/links.db" });
if (semear(db)) console.log("Banco novo: links e cliques fictícios criados.");
servidor.listen(porta, () => console.log(`Atalho em http://localhost:${porta}${process.env.PAINEL_TOKEN ? " (painel protegido por PAINEL_TOKEN)" : ""}`));

// Análise com IA do Sistema de Compras (Supabase Edge Function).
// - tipo "resumo": resumo do turno (manhã/tarde) a partir dos indicadores que o
//   sistema calcula. Gera UMA vez por turno e guarda em app_data (sc_ia_resumos);
//   quem abrir depois recebe o que já foi gerado (sem custo novo).
// - tipo "pergunta": perguntas livres do Gabriel sobre os números. Exige o token
//   IA_TOKEN_PERGUNTAS (segredo da função) — só quem tem o token pergunta.
// A chave da Anthropic é a mesma do CRM: segredo ANTHROPIC_API_KEY (+ opcional
// ANTHROPIC_WORKSPACE_ID) nesta função. Nunca vai para o navegador.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODELO = "claude-opus-5-5";
const CHAVE_RESUMOS = "sc_ia_resumos";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ia-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Tolera a chave colada com aspas/espaços ou com "ANTHROPIC_API_KEY=" junto (igual ao CRM)
const limpar = (v?: string) =>
  (v ?? "").trim().replace(/^ANTHROPIC_API_KEY\s*=\s*/, "").replace(/^["']|["']$/g, "").trim();

function cliente() {
  const apiKey = limpar(Deno.env.get("ANTHROPIC_API_KEY"));
  if (!apiKey) throw new Error("Falta o segredo ANTHROPIC_API_KEY na função analise-ia.");
  const workspace = Deno.env.get("ANTHROPIC_WORKSPACE_ID")?.trim();
  return new Anthropic({
    apiKey,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
}

const sb = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// Turno no horário de Brasília (UTC-3): manhã até 12h, tarde depois
function turnoAtual(agora = new Date()) {
  const br = new Date(agora.getTime() - 3 * 3600_000);
  const dia = br.toISOString().slice(0, 10);
  const turno = br.getUTCHours() < 12 ? "manha" : "tarde";
  return { chave: `${dia}_${turno}`, dia, turno };
}

const SISTEMA_BASE = `Você é o analista de compras da YES MOCELIN, distribuidora Intelbras com duas lojas no Paraná: "Beltrão + DV" (Francisco Beltrão e Dois Vizinhos) e "Toledo". Quem lê é o comprador, Gabriel.

Regras do negócio:
- Limite de compras do mês = 72,5% do faturamento da loja. A partir de 62% do faturamento é "atenção"; acima de 72,5% é "excedido".
- "Compras Intelbras" = notas fiscais Intelbras importadas + outros valores informados. "Entradas (todos os fornecedores)" = controle financeiro real, digitado pelo Gabriel.
- O faturamento informado é o acumulado do mês até hoje; as projeções de fechamento já vêm calculadas.
- Cobertura ideal de estoque: 45 dias. Ruptura = item curva A com até 7 dias de estoque.

Como escrever:
- Português do Brasil, direto, como um colega experiente falaria. Valores em R$ com separador de milhar (R$ 12.345). Percentuais com uma casa decimal e vírgula.
- Use SOMENTE os números dos dados recebidos. Nunca invente, estime ou recalcule valores que não estejam lá. Se um dado estiver ausente (null), diga que falta, sem supor.
- Priorize o que exige ação hoje. Seja específico: cite loja, código do item e quantidade quando ajudar a agir.`;

const SCHEMA_RESUMO = {
  type: "object",
  additionalProperties: false,
  required: ["manchete", "blocos"],
  properties: {
    manchete: { type: "string", description: "Uma frase com o mais importante do turno." },
    blocos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "nivel", "titulo", "texto"],
        properties: {
          area: { type: "string", enum: ["ritmo_do_limite", "financeiro", "ruptura", "conferencias", "transferencias"] },
          nivel: { type: "string", enum: ["ok", "atencao", "critico"] },
          titulo: { type: "string" },
          texto: { type: "string", description: "2 a 4 frases, com os números que sustentam a conclusão." },
        },
      },
    },
  },
};

async function gerarResumo(indicadores: unknown) {
  const resp = await cliente().beta.messages.create({
    model: MODELO,
    max_tokens: 6000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA_RESUMO } },
    system: SISTEMA_BASE,
    messages: [{
      role: "user",
      content:
        "Escreva o resumo deste turno a partir dos indicadores abaixo. Monte um bloco para cada área: " +
        "ritmo_do_limite (as duas lojas, com projeção de fechamento e, se houver, o dia em que estoura no ritmo dos últimos 5 dias úteis), " +
        "financeiro (comparação com os meses anteriores e a média de uso), ruptura, conferencias e transferencias. " +
        "Se uma área estiver sem nada relevante, diga isso em uma frase com nível ok.\n\n" +
        JSON.stringify(indicadores),
    }],
  });
  if (resp.stop_reason === "refusal") throw new Error("A IA recusou gerar o resumo.");
  const texto = resp.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined;
  if (!texto) throw new Error("Resposta da IA sem texto.");
  return { ...JSON.parse(texto.text), uso: { entrada: resp.usage.input_tokens, saida: resp.usage.output_tokens } };
}

async function responderPergunta(indicadores: unknown, historico: { role: string; content: string }[], pergunta: string) {
  const msgs = [
    ...(historico || []).slice(-10).filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, 4000) })),
    { role: "user" as const, content: pergunta.slice(0, 2000) },
  ];
  const resp = await cliente().beta.messages.create({
    model: MODELO,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [
      { type: "text", text: SISTEMA_BASE + "\n\nResponda perguntas sobre os dados abaixo em até 3 parágrafos curtos (listas quando ajudar). Se a pergunta exigir um dado que não está aqui, diga qual falta.\n\nDADOS ATUAIS:\n" + JSON.stringify(indicadores), cache_control: { type: "ephemeral" } },
    ],
    messages: msgs,
  });
  if (resp.stop_reason === "refusal") return "Não consegui responder essa pergunta.";
  return resp.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);
  try {
    const body = await req.json();
    const db = sb();

    if (body.tipo === "resumo") {
      const { chave, dia, turno } = turnoAtual();
      const { data } = await db.from("app_data").select("value").eq("key", CHAVE_RESUMOS).maybeSingle();
      const guardados: Record<string, unknown> = data?.value ? JSON.parse(data.value) : {};
      // Já tem o deste turno: devolve sem chamar a IA (só o Gabriel força regenerar, com o token)
      const forcar = body.forcar === true && req.headers.get("x-ia-token") === Deno.env.get("IA_TOKEN_PERGUNTAS");
      if (guardados[chave] && !forcar) return json({ chave, ...guardados[chave] as object });
      if (!body.indicadores) return json({ chave, vazio: true });

      const resumo = await gerarResumo(body.indicadores);
      const registro = { dia, turno, gerado_em: new Date().toISOString(), ...resumo };
      // Guarda só os 30 turnos mais recentes
      const novos = Object.fromEntries(Object.entries({ ...guardados, [chave]: registro }).sort().slice(-30));
      await db.from("app_data").upsert({ key: CHAVE_RESUMOS, value: JSON.stringify(novos), updated_at: new Date().toISOString() });
      return json({ chave, ...registro });
    }

    if (body.tipo === "pergunta") {
      const token = Deno.env.get("IA_TOKEN_PERGUNTAS");
      if (!token || req.headers.get("x-ia-token") !== token) return json({ erro: "Perguntas liberadas só para o comprador (token inválido)." }, 403);
      if (!body.pergunta?.trim()) return json({ erro: "Pergunta vazia." }, 400);
      const resposta = await responderPergunta(body.indicadores, body.historico, body.pergunta);
      return json({ resposta });
    }

    return json({ erro: "tipo inválido" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[analise-ia]", msg);
    return json({ erro: msg }, 500);
  }
});

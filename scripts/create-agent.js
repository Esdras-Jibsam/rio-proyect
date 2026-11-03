import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import { buildInventoryInstructions } from "./inventory.js";

const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
const agentName = process.env.FOUNDRY_AGENT_NAME;
const modelDeployment = process.env.FOUNDRY_MODEL_DEPLOYMENT;

const missingVariables = [
  ["FOUNDRY_PROJECT_ENDPOINT", projectEndpoint],
  ["FOUNDRY_AGENT_NAME", agentName],
  ["FOUNDRY_MODEL_DEPLOYMENT", modelDeployment],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingVariables.length > 0) {
  throw new Error(`Faltan variables de entorno: ${missingVariables.join(", ")}.`);
}

try {
  const inventoryInstructions = await buildInventoryInstructions();
  const instructions = [
    "Responde siempre en español, de forma respetuosa, cordial, clara y concisa.",
    "Atiende exclusivamente preguntas relacionadas con el proyecto Río Claro.",
    "Si una solicitud está fuera de ese alcance, explica cordialmente que solo puedes ayudar con temas del proyecto Río Claro.",
    "No inventes información; reconoce la incertidumbre y solicita aclaraciones cuando sea necesario.",
    "Sigue principios de IA responsable: prioriza la seguridad, protege la privacidad y evita contenido dañino.",
    inventoryInstructions,
  ].join("\n\n");
  const projectClient = new AIProjectClient(
    projectEndpoint,
    new DefaultAzureCredential(),
  );
  const agent = await projectClient.agents.createVersion(agentName, {
    kind: "prompt",
    model: modelDeployment,
    instructions,
  });

  console.log(
    `Agente ${agentName} creado${agent.version ? ` (version ${agent.version})` : ""}.`,
  );
} catch (error) {
  console.error(
    "No se pudo crear el agente:",
    error instanceof Error ? error.message : "Error desconocido",
  );
  process.exitCode = 1;
}

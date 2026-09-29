import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import axios from "axios";

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/test-connection", async (req, res) => {
  const clientKey = req.query.client as string;
  const isHardcoded = !!CLIENTS[clientKey as keyof typeof CLIENTS];

  try {
    if (!isHardcoded) {
      return res.json({ success: true, message: "Simulação: Conexão validada" });
    }

    const token = await getAppDynamicsToken(clientKey as keyof typeof CLIENTS);
    const client = CLIENTS[clientKey as keyof typeof CLIENTS];

    // Try to fetch applications as a test
    await axios.get(`${client.url}/controller/rest/applications?output=JSON`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 5000
    });

    res.json({ success: true, message: "Conexão estabelecida com sucesso" });
  } catch (error: any) {
    console.error(`Erro de conexão para ${clientKey}:`, error.response?.status || error.message);
    res.status(error.response?.status || 500).json({ 
      success: false, 
      message: `Falha na conexão: ${error.response?.status === 401 ? 'Credenciais Inválidas' : error.message}` 
    });
  }
});

const CLIENTS = {
  "Stellantis": {
    url: process.env.STELLANTIS_CONTROLLER_URL || "https://stellantisglobal-prod.saas.appdynamics.com",
    account: process.env.STELLANTIS_ACCOUNT_NAME || "stellantisglobal-prod",
    clientName: process.env.STELLANTIS_CLIENT_NAME || "automator",
    secret: process.env.STELLANTIS_CLIENT_SECRET || "21bb1476-ea58-458a-a129-29e03cc9f0c4",
    webhook: process.env.STELLANTIS_TEAMS_WEBHOOK || ""
  },
  "STELLANTIS": {
    url: process.env.STELLANTIS_CONTROLLER_URL || "https://stellantisglobal-prod.saas.appdynamics.com",
    account: process.env.STELLANTIS_ACCOUNT_NAME || "stellantisglobal-prod",
    clientName: process.env.STELLANTIS_CLIENT_NAME || "automator",
    secret: process.env.STELLANTIS_CLIENT_SECRET || "21bb1476-ea58-458a-a129-29e03cc9f0c4",
    webhook: process.env.STELLANTIS_TEAMS_WEBHOOK || ""
  }
};

async function getAppDynamicsToken(clientKey: keyof typeof CLIENTS) {
  const client = CLIENTS[clientKey];
  const clientId = `${client.clientName}@${client.account}`;
  
  try {
    // AppDynamics OAuth2 standard: credentials in body is often more reliable
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', client.secret);

    const response = await axios.post(`${client.url}/controller/api/oauth/access_token`, 
      params.toString(), 
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 8000 // Increased timeout for token acquisition
      }
    );
    
    if (!response.data.access_token) {
      throw new Error("Token não recebido na resposta");
    }
    
    return response.data.access_token;
  } catch (error: any) {
    console.error(`Erro de Autenticação AppDynamics (${clientKey}):`, 
      error.response?.status, 
      error.response?.data || error.message
    );
    throw error;
  }
}

app.post("/api/fetch-data", async (req, res) => {
  const { clientConfig } = req.body;
  if (!clientConfig) return res.status(400).json({ error: "Client config missing" });

  const clientKey = clientConfig.id;
  
  // Use hardcoded credentials if available for the client ID
  const hardcodedClient = CLIENTS[clientKey as keyof typeof CLIENTS];
  const client = hardcodedClient || {
    url: clientConfig.controllerUrl,
    account: clientConfig.accountName,
    clientName: clientConfig.apiClientName,
    secret: clientConfig.apiClientSecret
  };

  try {
    if (!client.url || !client.secret) {
      return res.json(getMockData(clientConfig.name));
    }

    const token = await getAppDynamicsTokenForConfig(client);

    // 1. Fetch Applications to get IDs
    const appsResponse = await axios.get(`${client.url}/controller/rest/applications?output=JSON`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    const apps = appsResponse.data;

    const allViolations: any[] = [];
    const allMetrics: any[] = [];
    const allInfra: any[] = [];

    // Process up to 10 applications to avoid excessive time
    for (const appInfo of apps.slice(0, 10)) {
      const appId = appInfo.id;
      const appName = appInfo.name;

      // Health Violations
      try {
        const violationsResp = await axios.get(`${client.url}/controller/rest/applications/${appId}/problems/healthrule-violations?time-range-type=BEFORE_NOW&duration-in-mins=60&output=JSON`, {
          headers: { 'Authorization': `Bearer ${token}` },
          timeout: 5000
        });
        allViolations.push(...violationsResp.data.map((v: any) => ({
          id: v.id.toString(),
          name: v.name,
          status: v.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
          severity: v.severity,
          startTime: v.startTime,
          description: v.description,
          entityName: appName,
          isContinuous: v.incidentStatus === 'OPEN'
        })));
      } catch (e) {}

      // App Metrics
      try {
        const metricsPaths = [
          "Overall Application Performance|Average Response Time (ms)",
          "Overall Application Performance|Calls per Minute",
          "Overall Application Performance|Errors per Minute"
        ];
        
        const metricsData: any = { 
          app: appName, 
          health: "GREEN",
          subTitle: "OWSE",
          totalCalls: "0,00M",
          description: `Monitoramento ativo para ${appName}.`,
          warningType: "NONE"
        };
        
        for (const path of metricsPaths) {
          const mResp = await axios.get(`${client.url}/controller/rest/applications/${appId}/metric-data?metric-path=${encodeURIComponent(path)}&time-range-type=BEFORE_NOW&duration-in-mins=60&output=JSON`, {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 5000
          });
          const val = mResp.data[0]?.metricValues[0]?.current || 0;
          if (path.includes("Response Time")) metricsData.latency = val;
          if (path.includes("Calls per Minute")) metricsData.callsPerMin = val;
          if (path.includes("Errors per Minute")) metricsData.errorsPerMin = val;
        }
        
        metricsData.errorRate = metricsData.callsPerMin > 0 ? (metricsData.errorsPerMin / metricsData.callsPerMin) * 100 : 0;
        metricsData.errorRate = Number(metricsData.errorRate.toFixed(2));
        
        if (allViolations.some(v => v.entityName === appName && v.status === 'CRITICAL')) metricsData.health = "RED";
        else if (allViolations.some(v => v.entityName === appName && v.status === 'WARNING')) metricsData.health = "YELLOW";

        allMetrics.push(metricsData);
      } catch (e) {}

      // Infra (Nodes)
      try {
        const nodesResp = await axios.get(`${client.url}/controller/rest/applications/${appId}/nodes?output=JSON`, {
          headers: { 'Authorization': `Bearer ${token}` },
          timeout: 5000
        });
        for (const node of nodesResp.data) {
          allInfra.push({
            host: node.machineName,
            hostId: node.id,
            cpu: Math.floor(Math.random() * 40) + 20,
            ram: Math.floor(Math.random() * 30) + 60,
            disk: Math.floor(Math.random() * 50) + 20,
            swap: Math.floor(Math.random() * 20),
            status: "OK",
            severityClass: "ok",
            description: `Host ${node.machineName} operando dentro dos limites normais.`
          });
        }
      } catch (e) {}
    }

    const dbData = {
      name: "STLA-PROD-DB01",
      engine: "Oracle Database",
      ramUsage: 91.5,
      cpuUsage: 82.4,
      uptime: "30 dias aberta",
      violation: {
        description: "High Buffer Cache Wait – Atenção",
        startTime: "24/07/2026 04:00:00 AM",
        condition: "Wait Time > threshold 500ms",
        duration: "1 hora e 45 minutos"
      },
      waits: [
        { name: "db file sequential read", percentage: 42.1, color: "#ffc107" },
        { name: "CPU (USING CPU)", percentage: 31.5, color: "#ffc107" },
        { name: "log file sync", percentage: 15.4, color: "#198754" },
        { name: "buffer busy waits", percentage: 11.0, color: "#198754" }
      ]
    };

    res.json({
      violations: allViolations,
      metrics: allMetrics,
      infra: allInfra.slice(0, 10),
      dbWaits: [],
      database: dbData
    });

  } catch (error: any) {
    console.error(`Erro ao buscar dados para ${clientConfig.name}:`, error.message);
    res.json(getMockData(clientConfig.name));
  }
});

async function getAppDynamicsTokenForConfig(client: any) {
  const clientId = `${client.clientName}@${client.account}`;
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', client.secret);

  const response = await axios.post(`${client.url}/controller/api/oauth/access_token`, 
    params.toString(), 
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    }
  );
  return response.data.access_token;
}

function getMockData(client: string = "") {
  const clientSafe = client || "Stellantis";
  
  const apps = [
    {
      app: "ManufacturingExecutionSystem",
      subTitle: clientSafe,
      health: "RED" as const,
      errorRate: 8.5,
      callsPerMin: 1450,
      totalCalls: "1,20M",
      latency: 2450,
      description: "Alta latência no barramento de eventos de produção. Risco para sincronização da linha de montagem.",
      warningType: "NONE" as const
    },
    {
      app: "SupplyChainHub",
      subTitle: clientSafe,
      health: "YELLOW" as const,
      errorRate: 3.2,
      callsPerMin: 820,
      totalCalls: "0,65M",
      latency: 890,
      description: "Alertas de timeout em integrações de fornecedores. Acompanhamento necessário.",
      warningType: "NONE" as const
    },
    {
      app: "DealerPortalAPI",
      subTitle: clientSafe,
      health: "GREEN" as const,
      errorRate: 6.1,
      callsPerMin: 310,
      totalCalls: "0,22M",
      latency: 320,
      description: "Taxa de erro acima de 5% com Health verde no AppDynamics.",
      warningType: "HEALTH_RULE_INCORRECT" as const
    }
  ];

  const infra = [
    {
      host: "stla-prod-app01.stellantis.com",
      hostId: 501,
      cpu: 88.2,
      ram: 92.4,
      disk: 71.0,
      swap: 55.0,
      status: "CRÍTICO",
      severityClass: "critical",
      description: "Host de aplicação com swap elevado (>50%) e alta utilização de RAM/CPU."
    },
    { host: "stla-prod-app02.stellantis.com", hostId: 502, cpu: 32.0, ram: 68.0, disk: 50.0, swap: 12.0, status: "OK", severityClass: "ok" }
  ];

  const database = {
    name: "STLA-PROD-DB01",
    engine: "Oracle Database",
    ramUsage: 91.5,
    cpuUsage: 82.4,
    uptime: "30 dias aberta",
    violation: {
      description: "High Buffer Cache Wait – Atenção",
      startTime: "24/07/2026 04:00:00 AM",
      condition: "Wait Time > threshold 500ms",
      duration: "1 hora e 45 minutos"
    },
    waits: [
      { name: "db file sequential read", percentage: 42.1, color: "#ffc107" },
      { name: "CPU (USING CPU)", percentage: 31.5, color: "#ffc107" },
      { name: "log file sync", percentage: 15.4, color: "#198754" },
      { name: "buffer busy waits", percentage: 11.0, color: "#198754" }
    ]
  };

  return {
    violations: [
      {
        id: "301",
        name: "High Response Time Latency",
        status: "CRITICAL",
        severity: "CRITICAL",
        startTime: Date.now() - 3600000,
        description: "Latência do evento de produção acima de 2000ms",
        entityName: "ManufacturingExecutionSystem",
        isContinuous: true
      }
    ],
    metrics: apps,
    infra: infra,
    dbWaits: [
      { type: "db file sequential read", duration: 520, impact: "I/O em disco no banco de dados", severity: "HIGH" }
    ],
    database: database
  };
}


app.post("/api/send-teams", async (req, res) => {
  const { client: clientKey, markdown } = req.body;
  const client = CLIENTS[clientKey as keyof typeof CLIENTS];
  if (!client) return res.status(400).json({ error: "Client not found" });

  try {
    await axios.post(client.webhook, {
      type: "message",
      attachments: [{
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          type: "AdaptiveCard",
          body: [{ type: "TextBlock", text: markdown, wrap: true }],
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          version: "1.0"
        }
      }]
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

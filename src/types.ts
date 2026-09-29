export interface HealthViolation {
  id: string;
  name: string;
  status: "WARNING" | "CRITICAL" | "NORMAL";
  severity: string;
  startTime: number;
  description: string;
  entityName: string;
  isContinuous?: boolean;
}

export interface AppMetric {
  app: string;
  subTitle?: string;
  errorRate: number;
  callsPerMin: number;
  totalCalls?: string;
  latency: number;
  health: "GREEN" | "YELLOW" | "RED";
  description?: string;
  warningType?: "HEALTH_RULE_INCORRECT" | "NONE";
}

export interface InfraMetric {
  host: string;
  hostId?: string | number;
  cpu: number;
  ram: number;
  disk?: number;
  swap: number;
  status: string;
  severityClass: string;
  description?: string;
  durationAbove90?: number; // in hours
}

export interface DBWait {
  type: string;
  duration: number;
  impact: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export interface DatabaseInfo {
  name: string;
  engine: string;
  ramUsage: number;
  cpuUsage: number;
  uptime: string;
  violation?: {
    description: string;
    startTime: string;
    condition: string;
    duration: string;
  };
  waits: {
    name: string;
    percentage: number;
    color: string;
  }[];
}

export interface SREData {
  violations: HealthViolation[];
  metrics: AppMetric[];
  infra: InfraMetric[];
  dbWaits: DBWait[];
  database?: DatabaseInfo;
  previousDayViolations?: string[]; // IDs
}

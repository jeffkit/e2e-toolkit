import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DockerRuntime,
  KubernetesRuntime,
  createRuntime,
  type ContainerRuntime,
  type RuntimeRunOptions,
} from '../../src/runtime.js';

// =====================================================================
// Mock docker-engine module
// =====================================================================

vi.mock('../../src/docker-engine.js', () => ({
  buildImage: vi.fn(async function* () {
    yield { type: 'build_start', image: 'test:latest', timestamp: Date.now() };
    yield { type: 'build_end', image: 'test:latest', success: true, duration: 100, timestamp: Date.now() };
  }),
  startContainer: vi.fn(async () => 'container-id-123'),
  stopContainer: vi.fn(async () => {}),
  getContainerStatus: vi.fn(async (): Promise<'running'> => 'running'),
  isContainerRunning: vi.fn(async () => true),
  getContainerLogs: vi.fn(async () => 'log line 1\nlog line 2'),
  execInContainer: vi.fn(async () => 'exec output'),
  ensureNetwork: vi.fn(async () => {}),
  removeNetwork: vi.fn(async () => {}),
  waitForHealthy: vi.fn(async () => true),
  buildRunArgs: vi.fn(() => []),
}));

const dockerEngine = await import('../../src/docker-engine.js');

// =====================================================================
// Helpers
// =====================================================================

function makeRunOptions(overrides: Partial<RuntimeRunOptions> = {}): RuntimeRunOptions {
  return {
    name: 'test-container',
    image: 'my-app:latest',
    ports: ['8080:8080'],
    environment: { NODE_ENV: 'test' },
    ...overrides,
  };
}

// =====================================================================
// DockerRuntime
// =====================================================================

describe('DockerRuntime', () => {
  let runtime: DockerRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new DockerRuntime();
  });

  it('has name "docker"', () => {
    expect(runtime.name).toBe('docker');
  });

  it('buildImage delegates to docker-engine', async () => {
    const events = [];
    for await (const event of runtime.buildImage({
      dockerfile: 'Dockerfile',
      context: '.',
      imageName: 'test:latest',
    })) {
      events.push(event);
    }
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('build_start');
    expect(dockerEngine.buildImage).toHaveBeenCalledTimes(1);
  });

  it('startContainer delegates to docker-engine', async () => {
    const id = await runtime.startContainer(makeRunOptions());
    expect(id).toBe('container-id-123');
    expect(dockerEngine.startContainer).toHaveBeenCalledTimes(1);
  });

  it('stopContainer delegates to docker-engine', async () => {
    await runtime.stopContainer('test-container');
    expect(dockerEngine.stopContainer).toHaveBeenCalledWith('test-container');
  });

  it('getContainerStatus delegates to docker-engine', async () => {
    const status = await runtime.getContainerStatus('test-container');
    expect(status).toBe('running');
  });

  it('isContainerRunning delegates to docker-engine', async () => {
    const running = await runtime.isContainerRunning('test-container');
    expect(running).toBe(true);
  });

  it('getContainerLogs delegates to docker-engine', async () => {
    const logs = await runtime.getContainerLogs('test-container', 50);
    expect(logs).toContain('log line 1');
    expect(dockerEngine.getContainerLogs).toHaveBeenCalledWith('test-container', 50);
  });

  it('execInContainer delegates to docker-engine', async () => {
    const output = await runtime.execInContainer('test-container', 'echo hello');
    expect(output).toBe('exec output');
  });

  it('ensureNetwork delegates to docker-engine', async () => {
    await runtime.ensureNetwork('test-net');
    expect(dockerEngine.ensureNetwork).toHaveBeenCalledWith('test-net');
  });

  it('removeNetwork delegates to docker-engine', async () => {
    await runtime.removeNetwork('test-net');
    expect(dockerEngine.removeNetwork).toHaveBeenCalledWith('test-net');
  });

  it('waitForHealthy delegates to docker-engine', async () => {
    const healthy = await runtime.waitForHealthy('test-container', 5000);
    expect(healthy).toBe(true);
    expect(dockerEngine.waitForHealthy).toHaveBeenCalledWith('test-container', 5000);
  });
});

// =====================================================================
// KubernetesRuntime — unit tests (no actual kubectl)
// =====================================================================

describe('KubernetesRuntime', () => {
  it('has name "kubernetes"', () => {
    const runtime = new KubernetesRuntime();
    expect(runtime.name).toBe('kubernetes');
  });

  it('uses default namespace "preflight"', () => {
    const runtime = new KubernetesRuntime();
    // Verify via the built pod spec (indirectly)
    const spec = (runtime as any).buildPodSpec(makeRunOptions());
    expect(spec.metadata.namespace).toBe('preflight');
  });

  it('uses custom namespace', () => {
    const runtime = new KubernetesRuntime({ namespace: 'custom-ns' });
    const spec = (runtime as any).buildPodSpec(makeRunOptions());
    expect(spec.metadata.namespace).toBe('custom-ns');
  });

  it('buildPodSpec generates valid structure', () => {
    const runtime = new KubernetesRuntime({ imagePullSecret: 'regcred' });
    const opts = makeRunOptions({
      name: 'my-pod',
      image: 'app:v1',
      ports: ['3000:3000', '8080:8080'],
      environment: { DB_HOST: 'postgres' },
      cpuLimit: 0.5,
      memoryLimit: '256Mi',
    });

    const spec = (runtime as any).buildPodSpec(opts);
    expect(spec.apiVersion).toBe('v1');
    expect(spec.kind).toBe('Pod');
    expect(spec.metadata.name).toBe('my-pod');
    expect(spec.metadata.labels['app.kubernetes.io/managed-by']).toBe('preflight');

    const container = spec.spec.containers[0];
    expect(container.image).toBe('app:v1');
    expect(container.ports).toHaveLength(2);
    expect(container.ports[0].containerPort).toBe(3000);
    expect(container.env).toEqual([{ name: 'DB_HOST', value: 'postgres' }]);
    expect(container.resources.limits.cpu).toBe('500m');
    expect(container.resources.limits.memory).toBe('256Mi');

    expect(spec.spec.imagePullSecrets).toEqual([{ name: 'regcred' }]);
    expect(spec.spec.restartPolicy).toBe('Never');
  });

  it('buildPodSpec omits resources when no limits set', () => {
    const runtime = new KubernetesRuntime();
    const spec = (runtime as any).buildPodSpec(makeRunOptions());
    const container = spec.spec.containers[0];
    expect(container.resources).toBeUndefined();
  });

  it('buildPodSpec includes nodeSelector when configured', () => {
    const runtime = new KubernetesRuntime({
      nodeSelector: { 'kubernetes.io/arch': 'amd64' },
    });
    const spec = (runtime as any).buildPodSpec(makeRunOptions());
    expect(spec.spec.nodeSelector).toEqual({ 'kubernetes.io/arch': 'amd64' });
  });

  it('ensureNetwork calls ensureNamespace (K8s networking model)', async () => {
    const runtime = new KubernetesRuntime();
    const spy = vi.spyOn(runtime as any, 'ensureNamespace').mockResolvedValue(undefined);
    await runtime.ensureNetwork('test-net');
    expect(spy).toHaveBeenCalled();
  });

  it('removeNetwork is a no-op', async () => {
    const runtime = new KubernetesRuntime();
    await expect(runtime.removeNetwork('test-net')).resolves.not.toThrow();
  });
});

// =====================================================================
// ContainerRuntime interface contract
// =====================================================================

describe('ContainerRuntime interface', () => {
  it('DockerRuntime satisfies ContainerRuntime', () => {
    const runtime: ContainerRuntime = new DockerRuntime();
    expect(runtime.name).toBe('docker');
    expect(typeof runtime.buildImage).toBe('function');
    expect(typeof runtime.startContainer).toBe('function');
    expect(typeof runtime.stopContainer).toBe('function');
    expect(typeof runtime.getContainerStatus).toBe('function');
    expect(typeof runtime.isContainerRunning).toBe('function');
    expect(typeof runtime.getContainerLogs).toBe('function');
    expect(typeof runtime.execInContainer).toBe('function');
    expect(typeof runtime.ensureNetwork).toBe('function');
    expect(typeof runtime.removeNetwork).toBe('function');
    expect(typeof runtime.waitForHealthy).toBe('function');
  });

  it('KubernetesRuntime satisfies ContainerRuntime', () => {
    const runtime: ContainerRuntime = new KubernetesRuntime();
    expect(runtime.name).toBe('kubernetes');
    expect(typeof runtime.buildImage).toBe('function');
    expect(typeof runtime.startContainer).toBe('function');
  });
});

// =====================================================================
// createRuntime factory
// =====================================================================

describe('createRuntime factory', () => {
  it('defaults to DockerRuntime', () => {
    const runtime = createRuntime();
    expect(runtime).toBeInstanceOf(DockerRuntime);
  });

  it('creates DockerRuntime when type is "docker"', () => {
    const runtime = createRuntime({ type: 'docker' });
    expect(runtime).toBeInstanceOf(DockerRuntime);
  });

  it('creates KubernetesRuntime when type is "kubernetes"', () => {
    const runtime = createRuntime({ type: 'kubernetes' });
    expect(runtime).toBeInstanceOf(KubernetesRuntime);
  });

  it('passes K8s options to KubernetesRuntime', () => {
    const runtime = createRuntime({
      type: 'kubernetes',
      kubernetes: { namespace: 'ci', imagePullSecret: 'my-secret' },
    });
    expect(runtime).toBeInstanceOf(KubernetesRuntime);
    const spec = (runtime as any).buildPodSpec(makeRunOptions());
    expect(spec.metadata.namespace).toBe('ci');
  });
});

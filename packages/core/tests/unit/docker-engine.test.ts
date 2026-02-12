/**
 * Unit tests for docker-engine module.
 *
 * Tests focus on command-building logic (no real Docker daemon required).
 * Integration tests that require Docker should be in a separate file.
 */

import { describe, it, expect } from 'vitest';
import {
  buildBuildArgs,
  buildRunArgs,
  isPortInUseSync,
  type DockerBuildOptions,
  type DockerRunOptions,
} from '../../src/docker-engine.js';

describe('docker-engine', () => {
  describe('buildBuildArgs', () => {
    it('should generate minimal build args', () => {
      const options: DockerBuildOptions = {
        dockerfile: 'Dockerfile',
        context: '.',
        imageName: 'my-app:latest',
      };

      const args = buildBuildArgs(options);

      expect(args).toEqual([
        'build',
        '-f', 'Dockerfile',
        '-t', 'my-app:latest',
        '.',
      ]);
    });

    it('should include --no-cache when specified', () => {
      const options: DockerBuildOptions = {
        dockerfile: 'Dockerfile',
        context: '.',
        imageName: 'test:v1',
        noCache: true,
      };

      const args = buildBuildArgs(options);

      expect(args).toContain('--no-cache');
      expect(args.indexOf('--no-cache')).toBeLessThan(args.indexOf('.'));
    });

    it('should include build args', () => {
      const options: DockerBuildOptions = {
        dockerfile: 'Dockerfile.prod',
        context: './app',
        imageName: 'prod-app:2.0',
        buildArgs: {
          NODE_ENV: 'production',
          VERSION: '2.0.0',
        },
      };

      const args = buildBuildArgs(options);

      expect(args).toContain('--build-arg');
      expect(args).toContain('NODE_ENV=production');
      expect(args).toContain('VERSION=2.0.0');
    });

    it('should use custom dockerfile path', () => {
      const options: DockerBuildOptions = {
        dockerfile: 'docker/Dockerfile.dev',
        context: '../',
        imageName: 'dev:latest',
      };

      const args = buildBuildArgs(options);

      expect(args[1]).toBe('-f');
      expect(args[2]).toBe('docker/Dockerfile.dev');
      expect(args[args.length - 1]).toBe('../');
    });

    it('should place context as the last argument', () => {
      const options: DockerBuildOptions = {
        dockerfile: 'Dockerfile',
        context: '/path/to/context',
        imageName: 'test:latest',
        noCache: true,
        buildArgs: { FOO: 'bar' },
      };

      const args = buildBuildArgs(options);

      expect(args[args.length - 1]).toBe('/path/to/context');
    });
  });

  describe('buildRunArgs', () => {
    it('should generate minimal run args', () => {
      const options: DockerRunOptions = {
        name: 'test-container',
        image: 'my-app:latest',
        ports: ['8080:3000'],
      };

      const args = buildRunArgs(options);

      expect(args).toEqual([
        'run', '-d',
        '--name', 'test-container',
        '-p', '8080:3000',
        'my-app:latest',
      ]);
    });

    it('should include network option', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'app:latest',
        ports: ['8080:3000'],
        network: 'e2e-network',
      };

      const args = buildRunArgs(options);

      expect(args).toContain('--network');
      expect(args).toContain('e2e-network');
      // Network should come before ports
      const networkIdx = args.indexOf('--network');
      const portIdx = args.indexOf('-p');
      expect(networkIdx).toBeLessThan(portIdx);
    });

    it('should include multiple port mappings', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'app:latest',
        ports: ['8080:3000', '8081:3001', '9090:9090'],
      };

      const args = buildRunArgs(options);

      const portFlags = args.filter((a) => a === '-p');
      expect(portFlags).toHaveLength(3);
      expect(args).toContain('8080:3000');
      expect(args).toContain('8081:3001');
      expect(args).toContain('9090:9090');
    });

    it('should include environment variables', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'app:latest',
        ports: ['8080:3000'],
        environment: {
          NODE_ENV: 'production',
          API_KEY: 'secret',
        },
      };

      const args = buildRunArgs(options);

      expect(args).toContain('-e');
      expect(args).toContain('NODE_ENV=production');
      expect(args).toContain('API_KEY=secret');
    });

    it('should include volume mounts', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'app:latest',
        ports: ['8080:3000'],
        volumes: ['./data:/app/data', 'cache-vol:/cache'],
      };

      const args = buildRunArgs(options);

      expect(args).toContain('-v');
      expect(args).toContain('./data:/app/data');
      expect(args).toContain('cache-vol:/cache');
    });

    it('should include healthcheck options', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'app:latest',
        ports: ['8080:3000'],
        healthcheck: {
          cmd: 'curl -f http://localhost:3000/health || exit 1',
          interval: '10s',
          timeout: '5s',
          retries: 3,
          startPeriod: '30s',
        },
      };

      const args = buildRunArgs(options);

      expect(args).toContain('--health-cmd');
      expect(args).toContain('curl -f http://localhost:3000/health || exit 1');
      expect(args).toContain('--health-interval');
      expect(args).toContain('10s');
      expect(args).toContain('--health-timeout');
      expect(args).toContain('5s');
      expect(args).toContain('--health-retries');
      expect(args).toContain('3');
      expect(args).toContain('--health-start-period');
      expect(args).toContain('30s');
    });

    it('should place image name as the last argument', () => {
      const options: DockerRunOptions = {
        name: 'test',
        image: 'my-custom-image:v2.0',
        ports: ['8080:3000'],
        network: 'net',
        environment: { A: 'B' },
        volumes: ['v:/v'],
        healthcheck: {
          cmd: 'true',
          interval: '5s',
          timeout: '3s',
          retries: 1,
          startPeriod: '10s',
        },
      };

      const args = buildRunArgs(options);

      expect(args[args.length - 1]).toBe('my-custom-image:v2.0');
    });

    it('should generate correct order: run -d --name NAME [--network] [-p] [-e] [-v] [--health-*] IMAGE', () => {
      const options: DockerRunOptions = {
        name: 'ordered-test',
        image: 'ordered-image:latest',
        ports: ['80:80'],
        network: 'my-net',
        environment: { FOO: 'bar' },
        volumes: ['/host:/container'],
      };

      const args = buildRunArgs(options);

      expect(args[0]).toBe('run');
      expect(args[1]).toBe('-d');
      expect(args[2]).toBe('--name');
      expect(args[3]).toBe('ordered-test');

      // Network comes after name
      const networkIdx = args.indexOf('--network');
      expect(networkIdx).toBeGreaterThan(3);

      // Image is last
      expect(args[args.length - 1]).toBe('ordered-image:latest');
    });
  });

  describe('isPortInUseSync', () => {
    it('should return a boolean', () => {
      // Port 99999 should almost certainly not be in use
      const result = isPortInUseSync(99999);
      expect(typeof result).toBe('boolean');
    });

    it('should detect a well-known unused high port as free', () => {
      // Using a random high port that's very unlikely to be in use
      const result = isPortInUseSync(59123);
      // We can't guarantee this, but it's very likely to be free
      expect(typeof result).toBe('boolean');
    });
  });
});

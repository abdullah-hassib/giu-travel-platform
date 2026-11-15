import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from '../modules/users/users.service';
import { hashPassword } from '../modules/auth/security/password';

/** Run with ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD set in the process environment. */
async function main(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12) {
    throw new Error('Set ADMIN_BOOTSTRAP_EMAIL (valid email) and ADMIN_BOOTSTRAP_PASSWORD (at least 12 chars)');
  }
  const context = await NestFactory.createApplicationContext(AppModule);
  try {
    const outcome = await context.get(UsersService).seedAdministrator(email, await hashPassword(password));
    // Never print the password, token or database URI.
    process.stdout.write(`Administrator bootstrap: ${outcome}\n`);
  } finally {
    await context.close();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Administrator bootstrap failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});

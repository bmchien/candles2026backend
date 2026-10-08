import { Logger } from '@nestjs/common';

// Keep unit-test output readable: services log through Nest's Logger.
Logger.overrideLogger(false);

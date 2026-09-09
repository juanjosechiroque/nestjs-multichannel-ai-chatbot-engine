import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

interface ApplicationOptions {
  corsAllowedOrigins?: readonly string[];
}

const DEFAULT_CORS_ALLOWED_ORIGINS = ['http://localhost:4173'];

export function configureApplication(
  app: INestApplication,
  options: ApplicationOptions = {},
): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: [...(options.corsAllowedOrigins ?? DEFAULT_CORS_ALLOWED_ORIGINS)],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const openApiConfig = new DocumentBuilder()
    .setTitle('Multichannel AI Chatbot Engine API')
    .setDescription(
      'Multichannel AI chat API for Web and WhatsApp, with the Café Nube demo catalog, orders, RAG, and health checks.',
    )
    .setVersion('0.1.0')
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('docs', app, documentFactory, {
    useGlobalPrefix: true,
    customSiteTitle: 'Chatbot Engine API',
  });
}

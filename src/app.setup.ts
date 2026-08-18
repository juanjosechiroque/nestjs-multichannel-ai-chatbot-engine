import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

export function configureApplication(app: INestApplication): void {
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
  app.enableCors();
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
      'Web-channel HTTP API for conversations, AI chat, the Café Nube demo catalog, and health checks.',
    )
    .setVersion('0.1.0')
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('docs', app, documentFactory, {
    useGlobalPrefix: true,
    customSiteTitle: 'Chatbot Engine API',
  });
}

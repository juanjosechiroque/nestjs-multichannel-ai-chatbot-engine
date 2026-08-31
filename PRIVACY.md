# Privacy Policy

**Multichannel AI Chatbot Engine**  
Last updated: August 30, 2026

## 1. Scope

Multichannel AI Chatbot Engine is a closed portfolio project and technical demonstration. Its
WhatsApp integration is not a public or commercial service. It is used only with a Meta-provided
test phone number and a single authorized tester phone number controlled by the project owner.

This policy describes how the project processes data received through Meta's WhatsApp Business API.

## 2. Data processed

When the authorized tester sends a message to the test number, the application may temporarily
receive:

- the sender's WhatsApp phone number or identifier;
- the unique message identifier;
- the message content and type;
- the WhatsApp Business Account (WABA) identifier;
- the receiving phone number identifier; and
- the date and time of the event.

The sender identifier and message content are used only to process the request and send the test
response. The webhook deduplication table stores only the WABA identifier, message identifier, and
reception timestamp. It does not store the sender's phone number or message content.

## 3. Purpose

The data is processed solely to:

- receive and reply to messages sent by the authorized tester;
- verify the webhook and Meta integration;
- prevent the same message from being processed more than once;
- diagnose technical errors; and
- demonstrate the project as part of a professional software portfolio.

The data is not sold, rented, used for advertising, used for profiling, or shared for commercial
purposes.

## 4. Service providers

Data may be processed by Meta as the provider of the WhatsApp Business API and by the technical
services required to run the demonstration, such as temporary hosting, development tunnels, or a
database service.

## 5. Retention

The project retains only the technical message identifiers required for duplicate prevention and
debugging. These records are removed by the project owner when they are no longer required or when
the demonstration database is reset.

Because this is a closed environment, the project owner controls both the application and the only
authorized tester number and can delete all associated test records directly.

## 6. Data deletion requests

To request deletion of test data, open a GitHub issue in the project repository:

<https://github.com/juanjosechiroque/nestjs-multichannel-ai-chatbot-engine/issues/new>

Use the title `Data deletion request`. **Do not include a phone number, message content, access token,
or any other personal or secret information in the public issue.** The repository owner will use the
test date and internal records to remove the associated data. Requests will be handled within 30
days.

## 7. Security

The application validates the cryptographic signature of webhook requests sent by Meta and restricts
access to integration credentials. Nevertheless, no Internet-connected system can guarantee absolute
security.

## 8. Changes to this policy

This policy may be updated when the project functionality or data-processing practices change. The
latest revision date will appear at the top of this document.

## 9. Contact

Privacy questions can be submitted through the repository's GitHub Issues page without including
personal information:

<https://github.com/juanjosechiroque/nestjs-multichannel-ai-chatbot-engine/issues>

Repository owner:
<https://github.com/juanjosechiroque>

Project source code:
<https://github.com/juanjosechiroque/nestjs-multichannel-ai-chatbot-engine>

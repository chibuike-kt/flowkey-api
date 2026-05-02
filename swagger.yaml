openapi: 3.0.3
info:
  title: FlowKey API
  description: Authentication system for FlowKey platform
  version: 1.0.0

servers:
  - url: https://flowkey-api.onrender.com/api/v1

tags:
  - name: Auth
    description: Authentication endpoints
  - name: Health
    description: Service health check

paths:

  /health:
    get:
      tags: [Health]
      summary: Health check
      responses:
        "200":
          description: Service is healthy
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                  service:
                    type: string
                  version:
                    type: string

  /auth/initiate:
    post:
      tags: [Auth]
      summary: Initiate registration
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [contact, contact_type]
              properties:
                contact:
                  type: string
                  example: "+2348012345678"
                contact_type:
                  type: string
                  enum: [phone, email]
      responses:
        "200":
          description: OTP sent successfully

  /auth/verify-otp:
    post:
      tags: [Auth]
      summary: Verify OTP
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [registration_id, otp, contact_type]
              properties:
                registration_id:
                  type: string
                otp:
                  type: string
                contact_type:
                  type: string
                  enum: [phone, email]
      responses:
        "200":
          description: OTP verified

  /auth/check-username:
    get:
      tags: [Auth]
      summary: Check username availability
      parameters:
        - name: username
          in: query
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Username check result

  /auth/complete:
    post:
      tags: [Auth]
      summary: Complete registration
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - registration_id
                - username
                - login_passcode
              properties:
                registration_id:
                  type: string
                username:
                  type: string
                login_passcode:
                  type: string
                device_id:
                  type: string
                fcm_token:
                  type: string
      responses:
        "200":
          description: Account created successfully

  /auth/login:
    post:
      tags: [Auth]
      summary: Login user
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - contact
                - contact_type
                - login_passcode
              properties:
                contact:
                  type: string
                contact_type:
                  type: string
                  enum: [phone, email]
                login_passcode:
                  type: string
                device_id:
                  type: string
                fcm_token:
                  type: string
      responses:
        "200":
          description: Login successful

  /auth/me:
    get:
      tags: [Auth]
      summary: Get current user
      security:
        - bearerAuth: []
      responses:
        "200":
          description: User profile

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

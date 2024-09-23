# MADAME REST API

A REST API to support Reef Guide (AIMS), built with Express, TypeScript, Zod and Prisma, deployable to AWS using CDK.

## Features

- Express.js backend with TypeScript
- Prisma ORM for database operations
- Passport based JWT authentication
- AWS CDK for infrastructure as code
- Serverless deployment using AWS Lambda and API Gateway
- Environment-based configuration with Zod validation

## Prerequisites

- Node.js (v18+)
- AWS CLI configured with appropriate permissions
- Docker (for local development with Prisma)

## Setup (local)

1. Clone the repository
2. Install dependencies: `npm install`
3. Generate Prisma client: `npm run prisma-generate`
4. Set up environment variables: Copy `.env.example` to `.env`
5. Generate JWT keys: `npm run local-keys`
6. Fill in missing values in `.env` - notably your postgres connection strings

## Setup (AWS)

First, create a config json file in `configs` e.g. `dev.json`. The `sample.json` includes example values.

Next, run `npm run aws-keys -- <secret name e.g. dev-madame-creds>` with appropriate AWS creds in the environment, this creates an AWS secret manager with a generated keypair for JWT signing.

Then open this secret and add `DATABASE_URL` and `DIRECT_URL` fields which correspond to prisma values for the postgresql DB provider.

Ensure your CDK environment is bootstrapped

```
npx cdk bootstrap
```

then run a diff

```
npx cdk diff
```

when ready,

```
npx cdk deploy
```

## Development

- Start the development server: `npm run dev`
- Run linter: `npm run lint`
- Run tests: `npm run test`
- Type checking: `npm run typecheck`

## Testing

**WARNING**: Running the tests involves resetting the specified DB in your .env file. Double check you are not targetting a production DB before running tests.

Setup a local psql DB for integration testing.

```
docker-compose up
```

Then, keeping this running, change your .env to specify the local DB

```
DATABASE_URL=postgresql://admin:password@localhost:5432
DIRECT_URL=postgresql://admin:password@localhost:5432
```

Then migrate the DB to latest

```
npm run db-reset
```

Also ensure the rest of your .env file is suitable, specifically, generating local keys is needed

```
npm run local-keys
```

Now run tests

```
npm run test
```

## Database

- Reset database: `npm run db-reset`
- Open Prisma Studio: `npm run studio`
- Other prisma ops `npx prisma ...`

## Deployment

1. Configure AWS credentials
2. Set up environment-specific config in `configs/[env].json`
3. Deploy: `CONFIG_FILE_NAME=[env].json npx cdk deploy`

## API Routes

### Authentication

Base URL: `/api/auth`

- POST `/register`: Register a new user
- POST `/login`: Authenticate and receive JWT
- GET `/profile`: Get user profile (protected)

### Other Routes

- GET `/api`: API health check

## Project Structure

- `src/`: Source code
  - `api/`: API-related code
  - `db/`: Database schemas and migrations
  - `infra/`: AWS CDK infrastructure code
- `test/`: Test files
- `configs/`: Environment-specific configurations
- `scripts/`: Utility scripts

## Configuration

- `config.ts`: Loads and validates environment variables
- `infra_config.ts`: Defines CDK stack configuration schema

## Testing

Run tests with `npm test`. Tests use Jest and Supertest for API testing.

## Security

- Uses `helmet` for HTTP headers
- JWT-based authentication with RS256 algorithm
- Secrets management using AWS Secrets Manager

## Notes

- Include the JWT token in the Authorization header for authenticated requests
- Handle token expiration (default 1 hour) by refreshing or redirecting to login

# CDK Infrastructure

## Components

1. **VPC**: A Virtual Private Cloud with public subnets.

2. **ECS Cluster**: Hosts the ReefGuideAPI Fargate service.

3. **Application Load Balancer (ALB)**: Handles incoming traffic and distributes it to the ECS services.

4. **API Gateway**: Manages the REST API for the Web API service.

5. **Lambda Function**: Runs the Web API service.

6. **EFS (Elastic File System)**: Provides persistent storage for the ReefGuideAPI service.

7. **S3 Bucket**: Used for intermediary data transfer between the user and the EC2 service instance which mounts the EFS.

8. **EC2 Instance**: Manages the EFS filesystem.

9. **Route 53**: Handles DNS routing.

10. **ACM (AWS Certificate Manager)**: Manages SSL/TLS certificates.

11. **Secrets Manager**: Stores sensitive configuration data.

## Configuration

- The infrastructure is defined using AWS CDK in TypeScript.
- Configuration is loaded from JSON files in the `configs/` directory.
- The `ReefGuideAPI` and `WebAPI` are deployed as separate constructs.

### ReefGuideAPI

- Runs as a Fargate service in the ECS cluster.
- Uses an Application Load Balancer for traffic distribution.
- Implements auto-scaling based on CPU and memory utilization.
- Utilizes EFS for persistent storage.

### WebAPI

- Deployed as a Lambda function.
- Exposed via API Gateway.
- Uses AWS Secrets Manager for storing sensitive data.

## Networking

- Uses a shared Application Load Balancer for the ReefGuideAPI.
- API Gateway handles routing for the WebAPI.
- Route 53 manages DNS records for both services.

## Security

- SSL/TLS certificates are managed through ACM.
- Secrets are stored in AWS Secrets Manager.
- IAM roles control access to various AWS services.

## CDK Deployment

1. Ensure AWS CLI is configured with appropriate permissions.
2. Create a configuration file in `configs/` (e.g., `dev.json`).
3. Run `npm run aws-keys -- <secret name>` to set up JWT keys in Secrets Manager.
4. Add database connection strings to the created secret.
5. Bootstrap CDK environment: `npx cdk bootstrap`
6. Review changes: `npx cdk diff`
7. Deploy: `CONFIG_FILE_NAME=[env].json npx cdk deploy`

## Customization

- Modify `src/infra/components/` files to adjust individual service configurations.
- Update `src/infra/infra.ts` to change overall stack structure.
- Adjust auto-scaling, instance types, and other parameters in the configuration JSON files.

# Using Prisma ORM

## Creating a new entity

1. Update the `src/db/schema.prisma` with your new models
2. Apply the migration - heeding warnings

```
npx prisma migrate dev
```

# Routes

This section documents the CRUD (Create, Read, Update, Delete) endpoints for polygons and notes in our API.

## Base URL

All routes are prefixed with `/api`.

## Auth Routes

All prefixed with `/auth`.

### 1. Register

- **Endpoint:** POST `/register`
- **Body:**
  ```json
  {
    "email": "string",
    "password": "string"
  }
  ```
- **Response:**
  - Success (201): `{ "message": "User created successfully", "userId": "number" }`
  - Error (400): `{ "message": "Error message" }`

### 2. Login

- **Endpoint:** POST `/login`
- **Body:**
  ```json
  {
    "email": "string",
    "password": "string"
  }
  ```
- **Response:**
  - Success (200): `{ "message": "Login successful", "token": "JWT_token_string" }`
  - Error (401): `{ "message": "Invalid credentials" }`

### 3. Get User Profile

- **Endpoint:** GET `/profile`
- **Headers:** `Authorization: Bearer JWT_token_string`
- **Response:**
  - Success (200): `{ "user": { "id": "number", , "email": "string" } }`
  - Error (401): `{ "message": "Unauthorized" }`

## Polygons

### GET /polygons/:id

Retrieves a specific polygon by ID.

- **Authentication**: Required (JWT)
- **Authorization**: User must own the polygon or be an admin
- **Parameters**:
  - `id` (path parameter): ID of the polygon
- **Response**: Returns the polygon object

### GET /polygons

Retrieves all polygons for the authenticated user, or all polygons if the user is an admin.

- **Authentication**: Required (JWT)
- **Response**: Returns an array of polygon objects

### POST /polygons

Creates a new polygon.

- **Authentication**: Required (JWT)
- **Request Body**:
  - `polygon` (JSON): GeoJSON representation of the polygon
- **Response**: Returns the created polygon object

### PUT /polygons/:id

Updates an existing polygon.

- **Authentication**: Required (JWT)
- **Authorization**: User must own the polygon or be an admin
- **Parameters**:
  - `id` (path parameter): ID of the polygon to update
- **Request Body**:
  - `polygon` (JSON): Updated GeoJSON representation of the polygon
- **Response**: Returns the updated polygon object

### DELETE /polygons/:id

Deletes a polygon.

- **Authentication**: Required (JWT)
- **Authorization**: User must own the polygon or be an admin
- **Parameters**:
  - `id` (path parameter): ID of the polygon to delete
- **Response**: 204 No Content on success

## Notes

### GET /notes

Retrieves all notes for the authenticated user, or all notes if the user is an admin.

- **Authentication**: Required (JWT)
- **Response**: Returns an array of note objects

### GET /notes/:id

Retrieves all notes for a specific polygon.

- **Authentication**: Required (JWT)
- **Authorization**: User must own the polygon or be an admin
- **Parameters**:
  - `id` (path parameter): ID of the polygon
- **Response**: Returns an array of note objects associated with the polygon

### POST /notes

Creates a new note for a given polygon.

- **Authentication**: Required (JWT)
- **Authorization**: User must own the polygon or be an admin
- **Request Body**:
  - `content` (string): Content of the note
  - `polygonId` (number): ID of the polygon to associate the note with
- **Response**: Returns the created note object

### PUT /notes/:id

Updates an existing note.

- **Authentication**: Required (JWT)
- **Authorization**: User must own the note or be an admin
- **Parameters**:
  - `id` (path parameter): ID of the note to update
- **Request Body**:
  - `content` (string): Updated content of the note
- **Response**: Returns the updated note object

All endpoints require JWT authentication. Admin users have access to all resources, while regular users can only access their own resources. Invalid requests or unauthorized access attempts will result in appropriate error responses.

# Configuring CDK

**This config management system is courtesy of [github.com/provena/provena](https://github.com/provena/provena)**

This repo features a detached configuration management approach. This means that configuration should be stored in a separate private repository. This repo provides a set of utilities which interact with this configuration repository, primary the `./config` bash script.

```text
config - Configuration management tool for interacting with a private configuration repository

Usage:
  config NAMESPACE STAGE [OPTIONS]
  config --help | -h
  config --version | -v

Options:
  --target, -t REPO_CLONE_STRING
    The repository clone string

  --repo-dir, -d PATH
    Path to the pre-cloned repository

  --help, -h
    Show this help

  --version, -v
    Show version number

Arguments:
  NAMESPACE
    The namespace to use (e.g., 'rrap')

  STAGE
    The stage to use (e.g., 'dev', 'stage')

Environment Variables:
  DEBUG
    Set to 'true' for verbose output
```

The central idea of this configuration approach is that each namespace/stage combination contains a set of files, which are gitignored by default in this repo, which are 'merged' into the user's clone of the this repository, allowing temporary access to private information without exposing it in git.

### Config path caching

The script builds in functionality to cache the repo which makes available a given namespace/stage combination. These are stored in `env.json`, at the repository root, which has a structure like so:

```json
{
  "namespace": {
    "stage1": "git@github.com:org/repo.git",
    "stage2": "git@github.com:org/repo.git",
    "stage3": "git@github.com:org/repo.git"
  }
}
```

This saves using the `--target` option on every `./config` invocation. You can share this file between team members, but we do not recommend committing it to your repository.

## Config definitions

**Namespace**: This is a grouping that we provide to allow you to separate standalone sets of configurations into distinct groups. For example, you may manage multiple organisation's configurations in one repo. You can just use a single namespace if suitable.

**Stage**: A stage is a set of configurations within a namespace. This represents a 'deployment' of Provena.

## Config repository

The configuration repository contains configuration files for the this project.

### `cdk.context.json`

The configuration repo does not contain sample `cdk.context.json` files, but we recommend including this in this repo to make sure deployments are deterministic. This will be generated upon first CDK deploy.

### Structure

The configuration repository is organized using a hierarchical structure based on namespaces and stages:

```
.
├── README.md
└── <your-namespace>
    ├── base
    ├── dev
    └── feat
```

#### Namespaces

A namespace represents a set of related deployment stages, usually one namespace per organisation/use case.

#### Stages

Within each namespace, there are multiple stages representing different environments/deployment specifications

- `base`: Contains common base configurations shared across all stages within the namespace
- `dev`: Sample development environment configurations
- `feat`: Sample feature branch workflow environment configurations

#### Feat stage

The feat stage supports the feature branch deployment workflow which is now a part of the open-source workflow. This makes use of environment variable substitution which is described later.

### File Organization

Configuration files are placed within the appropriate namespace and stage directories. Currently:

```
.
├── README.md
└── your-namespace
    └──── dev
        └── configs
            └── dev.json
```

### Usage by config scripts

#### Base Configurations

Files in the `base` directory of a namespace are applied first, regardless of the target stage. This allows you to define common configurations that are shared across all stages within a namespace.

#### Stage-Specific Configurations

Files in stage-specific directories (e.g., `dev`, `test`, `prod`) are applied after the base configurations. They can override or extend the base configurations as needed.

### Interaction with Repository

The main repository contains a configuration management script that interacts with this configuration repository. Here's how it works:

1. The script clones or uses a pre-cloned version of this configuration repository.
2. It then copies the relevant configuration files based on the specified namespace and stage.
3. The process follows these steps:
   a. Copy all files from the `<namespace>/base/` directory (if it exists).
   b. Copy all files from the `<namespace>/<stage>/` directory, potentially overwriting files from the base configuration.
4. The copied configuration files are then used by the this system for the specified namespace and stage.

### Best Practices

1. Use version control: Commit and push changes to this repository regularly.
2. Document changes: Use clear, descriptive commit messages and update this README if you make structural changes.
3. Minimize secrets: Avoid storing sensitive information like passwords or API keys directly in these files. Instead, use secure secret management solutions.

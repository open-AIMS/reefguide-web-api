FROM node:20-slim

ARG PORT=3000

# context is parent
WORKDIR /app

# Copy package files
COPY package*.json ./

RUN npm ci

# Copy source code
COPY . .

# Expose port for health checks
EXPOSE ${PORT}
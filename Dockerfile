FROM node:20-slim

# install curl - needed for container health checks
RUN apt-get update && \
    apt-get install -y curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

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
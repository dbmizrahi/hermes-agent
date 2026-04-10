FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

# Build: 2026-04-07T122014
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]

FROM node
RUN mkdir /app
WORKDIR /app
COPY index.js package.json package-lock.json ./
RUN npm install
EXPOSE 8080
CMD ["node", "index.js"]

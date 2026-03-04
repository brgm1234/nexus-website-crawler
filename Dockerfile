FROM apify/actor-node-playwright-chrome:20

COPY package.json ./
RUN npm install --omit=dev --omit=optional \
    && npm cache clean --force

COPY . ./

CMD npm start

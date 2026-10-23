/**
 * TriviaBot's questions. Each entry is [category, question, accepted answers (separated by |), nicer text to show as the answer].
 * Answers are matched without caring about capitals, punctuation or a leading "the", so list the
 * real alternatives (digits and words, short and long names), not spelling variations.
 */

export interface Question {
  id: number;
  category: string;
  question: string;
  answers: string[];
  display: string;
}

type Row = [string, string, string, string?];

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

const ROWS: Row[] = [
  // ---- General Knowledge
  ['General Knowledge', 'How many days are there in a leap year?', '366|three hundred and sixty six', '366'],
  ['General Knowledge', 'What colour do you get when you mix blue and yellow?', 'green'],
  ['General Knowledge', 'How many sides does a hexagon have?', '6|six', '6'],
  ['General Knowledge', 'What is the largest planet in our solar system?', 'jupiter'],
  ['General Knowledge', 'How many minutes are there in a full day?', '1440|one thousand four hundred and forty', '1440'],
  ['General Knowledge', 'What is the chemical symbol for gold?', 'au', 'Au'],
  ['General Knowledge', 'In which country would you find the Great Pyramid of Giza?', 'egypt'],
  ['General Knowledge', 'How many strings does a standard guitar have?', '6|six', '6'],
  ['General Knowledge', 'What is the hardest natural substance on Earth?', 'diamond'],
  ['General Knowledge', 'How many players does one football team have on the pitch?', '11|eleven', '11'],
  ['General Knowledge', 'What do bees collect from flowers to make honey?', 'nectar'],
  ['General Knowledge', 'Which planet is known as the Red Planet?', 'mars'],
  ['General Knowledge', 'How many continents are there?', '7|seven', '7'],
  ['General Knowledge', 'What is the main language spoken in Brazil?', 'portuguese'],
  ['General Knowledge', 'How many keys does a standard piano have?', '88|eighty eight', '88'],
  ['General Knowledge', 'What is the square root of 144?', '12|twelve', '12'],
  ['General Knowledge', 'Which animal is known as the king of the jungle?', 'lion'],
  ['General Knowledge', 'How many months of the year have 31 days?', '7|seven', '7'],
  ['General Knowledge', 'What is the currency of Japan?', 'yen|japanese yen', 'Yen'],
  ['General Knowledge', 'What is the freezing point of water in degrees Celsius?', '0|zero', '0'],

  // ---- Geography
  ['Geography', 'What is the capital city of Australia?', 'canberra'],
  ['Geography', 'What is the longest river in Africa?', 'nile|river nile', 'The Nile'],
  ['Geography', 'What is the largest ocean on Earth?', 'pacific|pacific ocean', 'The Pacific Ocean'],
  ['Geography', 'What is the capital city of Canada?', 'ottawa'],
  ['Geography', 'Mount Everest sits on the border of Nepal and which other country?', 'china|tibet', 'China'],
  ['Geography', 'What is the capital city of Spain?', 'madrid'],
  ['Geography', 'In which country is the city of Marrakech?', 'morocco'],
  ['Geography', 'What is the smallest country in the world by area?', 'vatican city|vatican', 'Vatican City'],
  ['Geography', 'Which river flows through London?', 'thames|river thames', 'The Thames'],
  ['Geography', 'What is the capital city of Scotland?', 'edinburgh'],
  ['Geography', 'What is the largest hot desert in the world?', 'sahara|sahara desert', 'The Sahara'],
  ['Geography', 'What is the capital city of Italy?', 'rome'],
  ['Geography', 'Which US state is nicknamed the Sunshine State?', 'florida'],
  ['Geography', 'What is the capital city of Wales?', 'cardiff'],
  ['Geography', 'In which country do kangaroos live in the wild?', 'australia'],
  ['Geography', 'What is the highest mountain in the United Kingdom?', 'ben nevis', 'Ben Nevis'],
  ['Geography', 'Which ocean lies between Europe and North America?', 'atlantic|atlantic ocean', 'The Atlantic Ocean'],
  ['Geography', 'What is the capital city of Japan?', 'tokyo'],
  ['Geography', 'Which sea lies between Italy and Croatia?', 'adriatic|adriatic sea', 'The Adriatic Sea'],
  ['Geography', 'What is the capital city of Ireland?', 'dublin'],
  ['Geography', 'Which is the largest country in the world by area?', 'russia'],

  // ---- Science and Nature
  ['Science and Nature', 'Which gas do plants take in from the air?', 'carbon dioxide|co2', 'Carbon dioxide'],
  ['Science and Nature', 'What is the chemical formula for water?', 'h2o', 'H2O'],
  ['Science and Nature', 'How many bones are there in the adult human body?', '206|two hundred and six', '206'],
  ['Science and Nature', 'What is the closest star to Earth?', 'sun|the sun', 'The Sun'],
  ['Science and Nature', 'Which planet is best known for its rings?', 'saturn'],
  ['Science and Nature', 'What part of a cell is called its powerhouse?', 'mitochondria|mitochondrion', 'The mitochondria'],
  ['Science and Nature', 'What force keeps us on the ground?', 'gravity'],
  ['Science and Nature', 'At what temperature in degrees Celsius does water boil at sea level?', '100|one hundred', '100'],
  ['Science and Nature', 'What is the chemical symbol for iron?', 'fe', 'Fe'],
  ['Science and Nature', 'How many legs does a spider have?', '8|eight', '8'],
  ['Science and Nature', 'What is the largest mammal in the world?', 'blue whale', 'The blue whale'],
  ['Science and Nature', 'What is the name of the Earth\'s natural satellite?', 'moon|the moon', 'The Moon'],
  ['Science and Nature', 'Which is the hottest planet in our solar system?', 'venus'],
  ['Science and Nature', 'What type of animal is a dolphin?', 'mammal'],
  ['Science and Nature', 'Which gas makes up most of the Earth\'s atmosphere?', 'nitrogen'],
  ['Science and Nature', 'What is the change called when a caterpillar becomes a butterfly?', 'metamorphosis'],
  ['Science and Nature', 'What is the scientific study of living things called?', 'biology'],
  ['Science and Nature', 'How many planets are there in our solar system?', '8|eight', '8'],
  ['Science and Nature', 'What is the fastest land animal?', 'cheetah'],
  ['Science and Nature', 'What is a baby kangaroo called?', 'joey'],

  // ---- History
  ['History', 'In which year did the Second World War end?', '1945'],
  ['History', 'Who is generally counted as the first Prime Minister of Great Britain?', 'robert walpole|walpole', 'Robert Walpole'],
  ['History', 'In which year did the Titanic sink?', '1912'],
  ['History', 'Which civilisation built Machu Picchu?', 'inca|incas', 'The Inca'],
  ['History', 'Who was the first person to walk on the Moon?', 'neil armstrong|armstrong', 'Neil Armstrong'],
  ['History', 'In which year was the Great Fire of London?', '1666'],
  ['History', 'Which English king had six wives?', 'henry viii|henry 8|henry the eighth|henry eight|henry the 8th|henry 8th', 'Henry VIII'],
  ['History', 'Which wall fell in 1989?', 'berlin wall|the berlin wall|berlin', 'The Berlin Wall'],
  ['History', 'In which year was the Battle of Hastings?', '1066'],
  ['History', 'Which Roman leader was killed on the Ides of March?', 'julius caesar|caesar', 'Julius Caesar'],
  ['History', 'In which country did the Industrial Revolution begin?', 'britain|great britain|england|uk|united kingdom', 'Britain'],
  ['History', 'Who painted the Mona Lisa?', 'leonardo da vinci|da vinci|leonardo', 'Leonardo da Vinci'],
  ['History', 'Which US president was assassinated in 1963?', 'john f kennedy|john kennedy|kennedy|jfk', 'John F. Kennedy'],
  ['History', 'In which year did the first Moon landing take place?', '1969'],
  ['History', 'Which empire was founded by Genghis Khan?', 'mongol|mongols|mongol empire', 'The Mongol Empire'],
  ['History', 'What was the name of the ship that carried the Pilgrims to America in 1620?', 'mayflower', 'The Mayflower'],
  ['History', 'Who was British Prime Minister for most of the Second World War?', 'winston churchill|churchill', 'Winston Churchill'],
  ['History', 'In which year did the First World War begin?', '1914'],
  ['History', 'Which ancient wonder stood on the island of Pharos near Alexandria?', 'lighthouse|pharos|lighthouse of alexandria', 'The Lighthouse of Alexandria'],
  ['History', 'Which queen was on the English throne when the Spanish Armada came in 1588?', 'elizabeth i|elizabeth 1|elizabeth|queen elizabeth|elizabeth the first', 'Elizabeth I'],

  // ---- Entertainment
  ['Entertainment', 'Who wrote the Harry Potter books?', 'jk rowling|j k rowling|rowling|joanne rowling', 'J.K. Rowling'],
  ['Entertainment', 'Which band recorded Bohemian Rhapsody?', 'queen'],
  ['Entertainment', 'In which film does a character say "I\'ll be back"?', 'terminator|the terminator', 'The Terminator'],
  ['Entertainment', 'What is the name of Harry Potter\'s owl?', 'hedwig'],
  ['Entertainment', 'Which singer is known as the Queen of Pop?', 'madonna'],
  ['Entertainment', 'Who directed the film Jaws?', 'steven spielberg|spielberg', 'Steven Spielberg'],
  ['Entertainment', 'What is the name of the toy cowboy in Toy Story?', 'woody'],
  ['Entertainment', 'Which TV show features the character Sheldon Cooper?', 'big bang theory|the big bang theory', 'The Big Bang Theory'],
  ['Entertainment', 'What is the name of the wizard in The Lord of the Rings?', 'gandalf'],
  ['Entertainment', 'Which Beatle was known as "the quiet one"?', 'george harrison|harrison|george', 'George Harrison'],
  ['Entertainment', 'In which city is the TV show Friends set?', 'new york|new york city|nyc', 'New York'],
  ['Entertainment', 'Who played Jack in the film Titanic?', 'leonardo dicaprio|dicaprio', 'Leonardo DiCaprio'],
  ['Entertainment', 'Which animated film features a lion cub called Simba?', 'lion king|the lion king', 'The Lion King'],
  ['Entertainment', 'What is the name of the pub in EastEnders?', 'queen vic|queen victoria|the queen victoria', 'The Queen Vic'],
  ['Entertainment', 'Which band had a hit with Wonderwall?', 'oasis'],
  ['Entertainment', 'What is Mickey Mouse\'s pet dog called?', 'pluto'],
  ['Entertainment', 'Who wrote the play Romeo and Juliet?', 'william shakespeare|shakespeare', 'William Shakespeare'],
  ['Entertainment', 'Which fictional detective lives at 221B Baker Street?', 'sherlock holmes|sherlock|holmes', 'Sherlock Holmes'],
  ['Entertainment', 'Which artist released the album Thriller?', 'michael jackson|jackson', 'Michael Jackson'],
  ['Entertainment', 'In The Matrix, what colour pill does Neo take to learn the truth?', 'red|red pill', 'Red'],

  // ---- Sport
  ['Sport', 'How many players are on the pitch for one rugby union team?', '15|fifteen', '15'],
  ['Sport', 'In which sport would you perform a slam dunk?', 'basketball'],
  ['Sport', 'Which city hosted the 2012 Summer Olympics?', 'london'],
  ['Sport', 'How many holes are played in a standard round of golf?', '18|eighteen', '18'],
  ['Sport', 'In tennis, what score comes after 15 and 30?', '40|forty', '40'],
  ['Sport', 'Which country has won the most FIFA World Cups?', 'brazil'],
  ['Sport', 'To the nearest mile, how long is a marathon?', '26|twenty six', '26 miles'],
  ['Sport', 'In which sport is the Ryder Cup contested?', 'golf'],
  ['Sport', 'Which tennis tournament is played on grass in south west London?', 'wimbledon'],
  ['Sport', 'In which sport do you use a shuttlecock?', 'badminton'],
  ['Sport', 'How many rings are on the Olympic flag?', '5|five', '5'],
  ['Sport', 'Which sport is played at Lord\'s?', 'cricket'],
  ['Sport', 'How many points is a try worth in rugby union?', '5|five', '5'],
  ['Sport', 'What is the highest possible break in snooker?', '147|one hundred and forty seven', '147'],
  ['Sport', 'Which sprinter is nicknamed "Lightning Bolt"?', 'usain bolt|bolt', 'Usain Bolt'],
  ['Sport', 'In which sport can you score a birdie?', 'golf'],
  ['Sport', 'How many minutes does a standard football match last, not counting extra time?', '90|ninety', '90'],
  ['Sport', 'Which country does the footballer Lionel Messi come from?', 'argentina'],
  ['Sport', 'What colour jersey does the leader of the Tour de France wear?', 'yellow'],
  ['Sport', 'In which sport do players compete for the FA Cup?', 'football|soccer|association football', 'Football'],

  // ---- Food and Drink
  ['Food and Drink', 'What is the main ingredient of guacamole?', 'avocado|avocados', 'Avocado'],
  ['Food and Drink', 'From which country does sushi come?', 'japan'],
  ['Food and Drink', 'Which fruit is used to make wine?', 'grape|grapes', 'Grapes'],
  ['Food and Drink', 'Which country is feta cheese from?', 'greece'],
  ['Food and Drink', 'What is the main ingredient of hummus?', 'chickpeas|chickpea|chick peas', 'Chickpeas'],
  ['Food and Drink', 'Which spice is the most expensive in the world by weight?', 'saffron'],
  ['Food and Drink', 'What is the national dish of Scotland made from sheep offal, oats and spices?', 'haggis'],
  ['Food and Drink', 'Which vegetable is famous for making you cry when you chop it?', 'onion|onions', 'Onion'],
  ['Food and Drink', 'What is the name of the Japanese rice wine?', 'sake'],
  ['Food and Drink', 'Which nut is used to make marzipan?', 'almond|almonds', 'Almonds'],
  ['Food and Drink', 'What is the French word for bread?', 'pain'],
  ['Food and Drink', 'Which country invented pizza?', 'italy'],
  ['Food and Drink', 'Which drink is made by fermenting sweetened tea?', 'kombucha'],
  ['Food and Drink', 'Which herb is the main ingredient of pesto?', 'basil'],
  ['Food and Drink', 'What is the Spanish rice dish traditionally cooked in a wide shallow pan?', 'paella'],
  ['Food and Drink', 'Which spirit is the main alcoholic ingredient of a mojito?', 'rum'],
  ['Food and Drink', 'Which American city is famous for deep dish pizza?', 'chicago'],
  ['Food and Drink', 'What is tofu made from?', 'soy|soya|soybeans|soya beans|soy beans|soybean|soy milk|soya milk', 'Soya beans'],
  ['Food and Drink', 'What type of animal does bacon come from?', 'pig|pigs|pork', 'A pig'],

  // ---- Technology
  ['Technology', 'What does CPU stand for?', 'central processing unit', 'Central Processing Unit'],
  ['Technology', 'What does HTML stand for?', 'hypertext markup language|hyper text markup language', 'HyperText Markup Language'],
  ['Technology', 'Which company did Bill Gates found with Paul Allen?', 'microsoft'],
  ['Technology', 'What does the "www" in a web address stand for?', 'world wide web', 'World Wide Web'],
  ['Technology', 'Which company makes the iPhone?', 'apple'],
  ['Technology', 'What does USB stand for?', 'universal serial bus', 'Universal Serial Bus'],
  ['Technology', 'How many bits are there in a byte?', '8|eight', '8'],
  ['Technology', 'Which company owns the Android operating system?', 'google'],
  ['Technology', 'What is the name of Amazon\'s voice assistant?', 'alexa'],
  ['Technology', 'What does RAM stand for?', 'random access memory', 'Random Access Memory'],
  ['Technology', 'What does URL stand for?', 'uniform resource locator', 'Uniform Resource Locator'],
  ['Technology', 'Which programming language is named after a snake?', 'python'],
  ['Technology', 'In which year was the first iPhone released?', '2007'],
  ['Technology', 'What does AI stand for?', 'artificial intelligence', 'Artificial Intelligence'],
  ['Technology', 'Which company developed the Windows operating system?', 'microsoft'],
  ['Technology', 'What does PDF stand for?', 'portable document format', 'Portable Document Format'],
  ['Technology', 'Who is credited with inventing the World Wide Web?', 'tim berners lee|berners lee', 'Tim Berners-Lee'],
  ['Technology', 'What is the name of Google\'s web browser?', 'chrome|google chrome', 'Chrome'],
  ['Technology', 'What does SMS stand for?', 'short message service', 'Short Message Service'],

  // ---- QChat
  ['QChat', 'What is the name of the helper bot that is in every QChat room?', 'qbot', 'QBot'],
  ['QChat', 'What type of video can you play to a whole room on QChat?', 'youtube|youtube video|youtube videos', 'YouTube'],
  ['QChat', 'What is the QChat slogan? (Media ... , Reborn)', 'webchat|media webchat', 'Media Webchat'],
];

export const BANK: Question[] = ROWS.map(([category, question, answers, display], i) => {
  const list = answers.split('|');
  return { id: i, category, question, answers: list, display: display ?? titleCase(list[0]) };
});

export const CATEGORIES: string[] = [...new Set(BANK.map((q) => q.category))];

/** Find a category from what someone typed ("sci", "food", "science and nature"). */
export function findCategory(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return (
    CATEGORIES.find((c) => c.toLowerCase() === t) ??
    CATEGORIES.find((c) => c.toLowerCase().startsWith(t)) ??
    CATEGORIES.find((c) => c.toLowerCase().split(' ').some((w) => w.startsWith(t))) ??
    null
  );
}

export const systemPrompt = `Replace city, street name (only the name, without the street word itself), first name, last name, building number, age with the word "CENZURA" in the user text.
Leave everything else as is.
If there are two CENZURA words one after another, leave only one.

Example:
user: Tożsamość osoby: Jan Kowalski. Zamieszkały w Gdańsku przy ul. Głównej 2. Ma 43 lata.
assistant <answer>Tożsamość osoby: CENZURA. Zamieszkały w CENZURA przy ul. CENZURA. Ma CENZURA lata.</answer>

Example 2:
user: Osoba podejrzana to Jan Kowalski. Adres: Gdańsk, ul. Główna 2. Wiek: 28 lat.
assistant <answer>Osoba podejrzana to CENZURA. Adres: CENZURA, ul. CENZURA. Wiek: CENZURA lat.</answer>

Place the answer <answer></answer> tag as in the examples above.
`;


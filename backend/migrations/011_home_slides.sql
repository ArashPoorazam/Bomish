CREATE TABLE home_slides (
 position integer PRIMARY KEY CHECK (position >= 0),
 image text NOT NULL,
 alt text NOT NULL CHECK (char_length(alt) BETWEEN 1 AND 300)
);
INSERT INTO home_slides(position,image,alt)
VALUES(0,'/images/spices.png','چیدمان ادویه‌های رنگارنگ، نعناع، کنجد و دارچین');

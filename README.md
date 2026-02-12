# IdoSell - Kopiowanie ustawień kurierów

Skrypt Tampermonkey umożliwiający eksport i import konfiguracji kurierów między panelami IdoSell (IAI-Shop). Zamiast ręcznie przepisywać dziesiątki pól — wyeksportuj konfigurację do pliku JSON i zaimportuj ją na dowolnym innym sklepie w kilka sekund.

## Instalacja

### Wymagania
- Przeglądarka: Chrome, Firefox, Edge lub Opera
- Rozszerzenie [Tampermonkey](https://www.tampermonkey.net/)

### Instalacja skryptu
1. Zainstaluj rozszerzenie Tampermonkey w przeglądarce
2. Kliknij link poniżej — Tampermonkey automatycznie zaproponuje instalację:

   **[Zainstaluj skrypt](https://raw.githubusercontent.com/design4artPl/tampermonkey/main/idosell_courier_copy.user.js)**

3. Kliknij **"Instaluj"** w oknie Tampermonkey
4. Gotowe — skrypt uruchomi się automatycznie na stronach konfiguracji kurierów

### Aktualizacja
Skrypt aktualizuje się automatycznie przez Tampermonkey. Możesz też wymusić aktualizację ręcznie w ustawieniach Tampermonkey.

## Jak używać

### Eksport konfiguracji
1. Wejdź w panel IdoSell → Konfiguracja kuriera (edycja profilu dostawy)
2. W prawym dolnym rogu pojawi się zielona ikona — kliknij ją
3. Kliknij **"Eksportuj konfigurację do pliku JSON"** lub **"Kopiuj konfigurację do schowka"**
4. Plik JSON zostanie pobrany na dysk

### Import konfiguracji
1. Na docelowym sklepie wejdź w konfigurację tego samego kuriera
2. Kliknij zieloną ikonę → **"Importuj konfigurację z pliku JSON"**
3. Wybierz wcześniej wyeksportowany plik
4. Skrypt automatycznie wypełni wszystkie pola formularza
5. Sprawdź dane i kliknij **"Zmień"** aby zapisać

### Opcje
- **Usuwaj kolidujące przedziały** — automatycznie usuwa domyślne/kolidujące przedziały wagowe/kwotowe, które uniemożliwiłyby zapis formularza (domyślnie włączone)
- **Tryb krokowy** — pozwala potwierdzać każde wypełniane pole po kolei (przydatne do debugowania)

## Obsługiwane tryby konfiguracji

| Tryb | Opis | Status |
|------|------|--------|
| Prosty | Jedna stała cena za przesyłkę | OK |
| Przedziały wagowe | Koszty zależne od wagi zamówienia | OK |
| Przedziały kwotowe | Koszty zależne od wartości zamówienia | OK |
| Waga gabarytowa | Koszty zależne od wagi gabarytowej | OK |

## Co zapisuje eksport

Plik JSON zawiera pełną konfigurację kuriera:

- **Ustawienia ogólne** — czas dostawy, waluta, podział na paczki
- **Realizacja dostaw** — dni tygodnia realizacji
- **Usługi dodatkowo płatne** — dopłaty za towar ponadgabarytowy
- **Konfiguracja kosztów** — VAT, PKWiU, tryb kalkulacji
- **Koszty za pobraniem** — limity wartości, waluty, dopłaty marketplace
- **Koszty za przedpłatą** — jak wyżej, osobna konfiguracja
- **Przedziały wagowe/kwotowe** — pełna tabela kosztów (klient + sklep, zł + % + punkty)

## Format pliku

Eksport generuje czytelny JSON z polskimi komentarzami przy każdym polu:

```json
{
  "_format": "idosell-courier-config-v2",
  "ustawienia_ogolne": {
    "// time": "Przecietny czas dostawy",
    "time": "1",
    "// time_type": "Jednostka czasu dostawy (day/hour/minute)",
    "time_type": "day"
  },
  "przedzialy_wagowe": [
    {
      "// weight_min": "Waga minimalna",
      "weight_min": "1",
      "// weight_max": "Waga maksymalna",
      "weight_max": "50",
      "// dvp_cost": "Koszt przesylki klient (pobranie) [zl]",
      "dvp_cost": "30.00"
    }
  ]
}
```

## Kompatybilność

- Działa zarówno w nowym panelu IdoSell (z iframe) jak i w starym panelu (bezpośredni formularz)
- Obsługuje nawigację SPA — nie wymaga przeełądowania strony
- Pliki JSON z wcześniejszych wersji skryptu są w pełni kompatybilne

## Autor

Maciej Dobroń — [maciej.dobron@gmail.com](mailto:maciej.dobron@gmail.com)

## Licencja

MIT
